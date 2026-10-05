# Spec: Credentials, credential routes and usage classes

- Package: `packages/core` (`credentials.ts`: ports and types), `packages/runtime` (stores, route state machines)
- Decisions: [ADR-0016](../adr/0016-providers-routes-profiles-capabilities.md), [ADR-0017](../adr/0017-sign-in-with-chatgpt-route.md)
- Collaborators: [Sign in with ChatGPT](chatgpt-sign-in.md), [OpenAI Responses provider](openai-responses-provider.md), [compatible endpoints](compatible-endpoints.md), [Gemini provider](gemini-provider.md), [configuration](configuration.md), [protocol](protocol.md)

## Responsibility

- Store and retrieve secrets **inside the runtime only**, behind a `CredentialStore` port.
- Define **credential routes**: how a model request is authorized, which account it uses, how it
  is billed or metered, and its live state (signed in, refreshing, quota-blocked…).
- Expose route state to clients **without any secret material**.
- Enforce that a request never silently changes route, account or usage class.

**Not responsible for:** wire protocols (provider adapters), model behaviour (profiles), or
deciding which route a task uses (the user or session config).

## Routes

| Route ID | Adapter | Credential | Usage class | Notes |
|---|---|---|---|---|
| `gemini.api_key` | `provider-gemini` | API key (`GEMINI_API_KEY` env or Keychain item) | `api_metered` | Founding route, unchanged |
| `openai.api_key` | `provider-openai` | API key (`OPENAI_API_KEY` env or Keychain item) | `api_metered` | Full Responses features per model |
| `openai.chatgpt_subscription` | `provider-openai` | SIWC OAuth token set per account | `subscription_allowance` | [chatgpt-sign-in](chatgpt-sign-in.md); preview limits |
| `compat:<endpointId>` | `provider-compatible` | Keychain item, env var, or `none` (declared local) | `api_metered` (hosted) or `local_compute` | [compatible-endpoints](compatible-endpoints.md) |
| `fake` | fake provider | none | `none` | Tests only |

A **session** selects one route and model; a **task** inherits it. Changing route mid-task is a
`provider switch` at a safe boundary ([context compiler](context-compiler.md#provider-and-route-switches)).

## Interfaces

```ts
type CredentialRef = Brand<string, "CredentialRef">;          // "cred_" + 16 base32; opaque, safe to log

interface CredentialStore {
  readonly kind: "macos_keychain" | "env_only" | "memory_test";
  get(ref: CredentialRef): Promise<SecretBytes | undefined>;   // SecretBytes never serializes (toJSON throws)
  put(ref: CredentialRef, secret: SecretBytes, meta: CredentialMeta): Promise<void>;
  delete(ref: CredentialRef): Promise<void>;
  /** Atomically replace a token set (refresh rotation). Fails if the stored version changed. */
  compareAndSwap(ref: CredentialRef, expectedVersion: number, next: SecretBytes): Promise<"ok" | "conflict">;
  list(): Promise<readonly CredentialMeta[]>;                   // metadata only
}

interface CredentialMeta {
  ref: CredentialRef;
  routeId: RouteId;
  kind: "api_key" | "oauth_token_set" | "endpoint_key";
  accountLabel?: string;            // e.g. masked email "j…@example.com" (display only)
  createdAt: string;
  version: number;                  // increments on every write
}

type RouteState =
  | { state: "not_configured" }
  | { state: "authorizing"; attemptId: string }                 // SIWC sign-in in progress
  | { state: "ready"; accountLabel?: string; expiresAt?: string }
  | { state: "refreshing" }
  | { state: "reauth_required"; reason: "refresh_rejected" | "revoked" | "scope_missing" | "account_changed" }
  | { state: "plan_permission_missing" }                       // identity granted, plan scope not granted
  | { state: "quota_exhausted"; detail: string; since: string } // never a fabricated reset time
  | { state: "usage_unavailable"; since: string }
  | { state: "signing_out" }
  | { state: "signed_out"; revocation: "confirmed" | "unconfirmed" | "not_applicable" }
  | { state: "disabled"; reason: "distribution_ineligible" | "offline_mode" | "store_unavailable" | "policy" };

interface CredentialRoute {
  readonly id: RouteId;
  readonly usageClass: UsageClass;              // "api_metered" | "subscription_allowance" | "local_compute" | "none"
  state(): RouteState;
  /** Returns request auth for the adapter; refreshes single-flight if needed. Never logged. */
  authorize(signal: AbortSignal): Promise<RequestAuth>;
  /** Called by adapters with classified errors (401, quota codes, 503 usage unavailable). */
  report(event: RouteSignal): void;
}

interface RequestAuth { headers: Readonly<Record<string, string>>; origin: string; accountScope?: string }
```

- `SecretBytes` is a wrapper class whose `toString`, `toJSON` and `util.inspect` return
  `"[secret]"`. Structured logging rejects objects containing it.
- `RequestAuth.origin` binds the credential to one origin; adapters refuse to attach it to any
  other origin, including after redirects.
- `accountScope` (an opaque hash of the account key) tags provider-native replay items so they
  never cross accounts ([ADR-0016](../adr/0016-providers-routes-profiles-capabilities.md)).

## macOS Keychain store

- Generic password items, service `dev.kai.agent`, account = `CredentialRef`, data = UTF-8 JSON
  (`{v, kind, secret | tokens}`), accessibility `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`.
- Accessed from the **runtime process** through a maintained N-API keychain binding (candidate
  to evaluate in Phase 8: `@napi-rs/keyring`; licence and maintenance checked before adoption).
  Not through the `security` CLI, which would expose secrets in argv.
- Signed app builds use a stable code signature so the Keychain does not prompt on every update;
  unsigned development builds may prompt once per item.
- If the Keychain is unavailable or locked: `RouteState.disabled {store_unavailable}` for
  OAuth routes; API-key routes may still read **environment variables**. Kai never falls back
  to a plaintext file.
- `env_only` store (CLI, CI): reads `*_API_KEY` variables; OAuth routes are disabled.

## Rules

1. **Secrets never cross KSP.** KSP carries `CredentialRef`, `RouteState` and masked labels
   only ([protocol](protocol.md)). API keys typed in the app go renderer → runtime in a single
   `credentials.put` request whose `secret` field is excluded from event logging and never
   echoed; the response is the `CredentialRef`.
2. **Secrets never enter events, logs, artifacts or model input.** Redaction patterns include the
   formats of stored secrets as a second line of defence.
3. **Environment sanitization** for commands strips all route variables
   ([ADR-0013](../adr/0013-workspace-safety-and-checkpoints.md)).
4. **No silent route change.** On `quota_exhausted`, `reauth_required`, `plan_permission_missing`
   or `usage_unavailable` (after retries), the task pauses as `blocked {reason: "route"}` with
   its state intact. Continuing requires an explicit `task.resume {routeId?}` from the user.
5. **Usage classes are never mixed in totals.** `subscription_allowance` usage is shown as plan
   usage with tokens, never as `$0`. `local_compute` is shown as tokens and wall time.

## Events

`RouteConfigured {routeId, credentialRef?, usageClass}`, `RouteStateChanged {routeId, from, to,
reason}`, `CredentialRotated {credentialRef, version}` (no values), `ProviderSwitched {taskId,
fromRoute, toRoute, epochId}`. None contains a secret or a token-derived value other than the
opaque `accountScope`.

## Telemetry

Route state durations, refreshes (count, failures), quota events by route, requests by usage
class, Keychain errors by code.

## Acceptance tests

1. Property: serializing any KSP message, event payload or log record that passed through a
   route never contains a registered secret (fuzz with random secrets).
2. Keychain unavailable → OAuth route `disabled {store_unavailable}`; Gemini via env still works.
3. A redirect from the configured origin to another origin → the adapter drops the request and
   reports `redirect_refused`; the fake server at the second origin receives no auth header.
4. `quota_exhausted` mid-task → task `blocked {route}`; no request on any other route until
   `task.resume`.
5. `compareAndSwap` conflict during concurrent refresh → exactly one rotation persists
   ([chatgpt-sign-in](chatgpt-sign-in.md#refresh)).
