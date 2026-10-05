/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Credential store port and credential routes. Secrets never leave the runtime: KSP, events,
 * logs, renderer state and model input see only CredentialRef, RouteState and masked labels.
 * Spec: docs/specs/credentials.md, docs/specs/chatgpt-sign-in.md · Decisions: docs/adr/0016, docs/adr/0017.
 */
import type { AccountKey, CredentialRef, RouteId, RouteState, UsageClass } from "@kai/protocol";

declare const secretBrand: unique symbol;
/**
 * Secret bytes. The implementation is a class whose toString/toJSON/inspect return "[secret]";
 * structured logging rejects objects containing it.
 */
export interface SecretBytes {
  readonly [secretBrand]: true;
  readonly byteLength: number;
}

export interface CredentialMeta {
  readonly ref: CredentialRef;
  readonly routeId: RouteId;
  readonly kind: "api_key" | "oauth_token_set" | "endpoint_key";
  readonly accountLabel?: string; // masked, display only
  readonly createdAt: string;
  readonly version: number; // increments on every write
}

export interface CredentialStore {
  readonly kind: "macos_keychain" | "env_only" | "memory_test";
  get(ref: CredentialRef): Promise<SecretBytes | undefined>;
  put(ref: CredentialRef, secret: SecretBytes, meta: CredentialMeta): Promise<void>;
  delete(ref: CredentialRef): Promise<void>;
  /** Atomic replace for refresh-token rotation; "conflict" if another writer won. */
  compareAndSwap(ref: CredentialRef, expectedVersion: number, next: SecretBytes): Promise<"ok" | "conflict">;
  list(): Promise<readonly CredentialMeta[]>;
}

/** What an adapter attaches to a request. Bound to one origin; never logged. */
export interface RequestAuth {
  readonly headers: Readonly<Record<string, string>>;
  readonly origin: string; // scheme://host:port; attaching to any other origin is refused
  readonly accountScope?: string; // opaque hash used to tag replay items
}

/** Classified signals adapters report to the route (no raw bodies, no secrets). */
export type RouteSignal =
  | { readonly kind: "unauthorized" } // 401
  | { readonly kind: "quota_exhausted"; readonly code: string } // e.g. subscription_sharing_usage_limit_exceeded
  | { readonly kind: "usage_unavailable"; readonly code: string } // e.g. subscription_sharing_usage_unavailable
  | { readonly kind: "insufficient_quota" } // API key billing quota
  | { readonly kind: "ok" };

export interface CredentialRoute {
  readonly id: RouteId;
  readonly usageClass: UsageClass;
  state(): RouteState;
  /** Returns request auth; refreshes single-flight (in-process mutex + cross-process lock) if needed. */
  authorize(signal: AbortSignal): Promise<RequestAuth>;
  report(signal: RouteSignal): void;
}

// ---------------------------------------------------------------------------------------------
// Sign in with ChatGPT (docs/specs/chatgpt-sign-in.md). Values listed here are documented in the
// extension research (DI) or are open questions O1–O9 with conservative defaults.
// ---------------------------------------------------------------------------------------------

export type ReleaseDistribution = "personal_local" | "open_source" | "commercial_approved" | "commercial_unapproved";

/** Persisted once per installation at <KAI_HOME>/identity/host.json. Not a client registration. */
export interface HostIdentity {
  readonly v: 1;
  readonly extAgentHostId: string; // base64url(32 random bytes); opaque; no user data
  readonly createdAt: string;
}

export interface ChatGptAccountRegistration {
  readonly accountKey: AccountKey;
  readonly issuedClientId: string; // from the registration callback; reused for refresh/revoke/sign-in
  readonly accountLabel: string; // masked email
  readonly workspaceLabel?: string;
  readonly createdAt: string;
  readonly lastSignInAt: string;
}

export type SiwcIdentityScope = "openid" | "profile" | "email";
export type SiwcPlanScope = "offline_access" | "resource.invoke" | "chatgpt.tokens.use.direct";
export type SiwcResource = "https://api.openai.com/v1";

export interface SiwcAttempt {
  readonly attemptId: string;
  readonly state: SecretBytes; // single-use; compared in constant time
  readonly nonce: SecretBytes;
  readonly codeVerifier: SecretBytes; // S256 challenge goes in the URL, verifier only in the token request
  readonly redirectUri: `http://127.0.0.1:${number}/callback`;
  readonly clientId: "dynamic_agent_client" | string; // issued id when re-signing into a known account
  readonly accountKey?: AccountKey;
  readonly expiresAt: string; // +10 minutes
}

export type SiwcAttemptResult =
  | { readonly result: "ok"; readonly accountKey: AccountKey; readonly planPermission: boolean }
  | { readonly result: "denied" }
  | { readonly result: "cancelled" }
  | { readonly result: "expired" }
  | { readonly result: "state_mismatch" }
  | { readonly result: "identity_invalid"; readonly check: "signature" | "issuer" | "audience" | "expired" | "nonce" }
  | { readonly result: "account_mismatch" }
  | { readonly result: "failed"; readonly reason: "missing_code" | "registration_missing" | "token_response_invalid" | "network" | string };

export interface ChatGptAuthService {
  begin(accountKey: AccountKey | undefined): Promise<{ readonly attemptId: string; readonly authorizeUrl: string }>;
  cancel(attemptId: string): void;
  /** Resolves when the loopback callback completes, fails or expires. */
  outcome(attemptId: string): Promise<SiwcAttemptResult>;
  signOut(accountKey: AccountKey): Promise<{ readonly revocation: "confirmed" | "unconfirmed" }>;
  route(accountKey: AccountKey): CredentialRoute;
}
