# Spec: Kai Session Protocol (KSP)

- Package: `packages/protocol`
- Decision: [ADR-0002](../adr/0002-runtime-client-boundary.md); amended by [ADR-0024](../adr/0024-macos-desktop-shell.md) (macOS app client, `MessagePort` transport) and ADRs [0018](../adr/0018-providers-routes-profiles-capabilities.md)–[0023](../adr/0023-chrome-research.md) (routes, auth, endpoints, learning, research)

## Responsibility

KSP is the only contract between the **Kai Runtime**, which owns the workspace, model calls,
credentials, the research browser and state, and **clients** (the macOS app and the CLI in R1;
the benchmark harness; later an ACP adapter). Clients never access the filesystem, git,
processes, credentials or the browser directly.

**Credential-free rule.** No KSP response, notification or event carries secret material (API
keys, OAuth tokens, authorization codes, PKCE verifiers, `state`, `nonce`, cookies). Requests may
carry a secret only in `credentials.put.secret`, which transports mark non-loggable and the
runtime never echoes. Clients see `CredentialRef`s, masked labels and `RouteState`s
([credentials](credentials.md#rules)).

**Not responsible for:** rendering, authentication for remote transports (post-v1), or provider
APIs.

## Transport and framing

- JSON-RPC 2.0 semantics: `request {id, method, params}` → `response {id, result | error}`.
  Notifications have no `id`.
- v1 transports:
  - `InMemoryTransport`: the CLI hosts the runtime in-process.
  - `StdioTransport`: newline-delimited JSON, used by the headless runner and the benchmark
    harness.
  - `MessagePortTransport`: the macOS app's renderer ↔ runtime (`utilityProcess`) channel
    ([macos-client](macos-client.md#ksp-over-messageport)); messages ≤ 4 MB.
- Every message is validated with Zod on both sides. Unknown fields are ignored. Unknown methods
  return error code `-32601`.

## Lifecycle

```
client → initialize {clientName, clientVersion, protocolVersion, capabilities}
runtime ← {protocolVersion, runtimeVersion, capabilities: {stateModes, languages, packs, ...}}
client → workspace.open {path, options}
client → session.create {workspaceId, model?, config?}  | session.resume {sessionId}
client → session.subscribe {sessionId, afterSeq?}       // snapshot + event stream
client → task.submit {sessionId, prompt, attachments?, acceptance?}
         ... runtime emits events; may send permission.request ...
client → permission.respond {requestId, decision, remember?}
client → task.steer {taskId, message}       // queued after the current model turn
client → task.cancel {taskId}
client → session.close {sessionId}
```

## Methods (v1)

| Method | Params | Result |
|---|---|---|
| `initialize` | client info, `protocolVersion` | runtime info, capabilities |
| `workspace.open` | `path`, `{worktree?: boolean}` | `WorkspaceInfo` (id, root, vcs, detected languages, profile status) |
| `workspace.profile.get` / `.set` | — / `VerificationProfile` | the profile |
| `session.create` / `.resume` / `.list` / `.close` | … | `SessionInfo` |
| `session.subscribe` | `sessionId`, `afterSeq?` | `{snapshot: SessionSnapshot, snapshotSeq}`, then `event` notifications |
| `task.submit` | `sessionId`, `prompt`, `acceptance?: string[]` | `{taskId}` |
| `task.steer` | `taskId`, `message` | `{}` |
| `task.cancel` | `taskId` | `{}` |
| `task.report` | `taskId` | `TaskReport` (state, evidence, diff stat, telemetry summary) |
| `permission.respond` | `requestId`, `decision: allow\|deny`, `remember?: "session"\|"workspace"` | `{}` |
| `checkpoint.list` / `.restore` | `sessionId` / `checkpointId`, `paths?` | — |
| `artifact.read` | `artifactId`, `range?` | text slice (for UI viewers) |
| `stats.get` | `scope: turn\|task\|session\|workspace`, `id` | telemetry aggregates |
| `config.get` / `.set` | key/value (typed) | — |
| `task.amend` | `taskId`, `objective?`, `acceptance?` (user only) | `{}`; emits `TaskAmended` |
| `task.resume` | `taskId`, `routeId?`, `model?` | `{}`; resumes a `blocked` task, optionally on an explicitly chosen route |
| `task.switchRoute` | `taskId`, `routeId`, `model`, `accountKey?`, `confirmPrivacyChange?` | `{}`; switch at the next safe point |
| `project.create` / `.list` / `.finalize` / `.reopen` | `title` / — / `projectId, outcome, feedback?` / `projectId` | `ProjectInfo` |
| `provider.routes` | — | routes with `RouteState`, usage class, default profile |
| `provider.models` | `routeId`, `accountKey?` | discovered catalog (`slug`, `displayName`) |
| `provider.probe` | `routeId`, `model` | `CapabilitySnapshot` (discloses billable cost first via `permission.request kind="probe"` when billable) |
| `credentials.put` / `.delete` / `.list` | `routeId`, `secret` / `credentialRef` / — | `CredentialRef` / `{}` / metadata only |
| `auth.chatgpt.begin` / `.cancel` / `.status` / `.signOut` / `.select` | see [sign-in](chatgpt-sign-in.md#ksp) | attempt URL / — / accounts / `{revocation}` / — |
| `endpoint.upsert` / `.remove` / `.doctor` | endpoint config (no inline secrets) / `endpointId` / `endpointId, reprobe?` | validated config / — / doctor report |
| `learning.status` / `.list` / `.get` / `.setEnabled` / `.retire` / `.restore` / `.rollback` / `.delete` / `.export` / `.reset` / `.reflectNow` | see [learning](learning-service.md#user-controls) | records (no secrets) |
| `research.status` | — | `ChromeStatus`, policy, budgets |
| `research.setMode` / `research.setChromePath` / `research.resetProfile` | mode / path / — | `ChromeStatus` |
| `research.handoff.open` / `.skip` | `opId` | `{}` |
| `research.source.get` | `sourceId` | `SourceRecord` + excerpt (`artifact.read` for full text) |
| `runtime.shutdown` | `deadlineMs` | `{}` (app quit; [lifecycle](macos-client.md#lifecycle)) |

## Notifications (runtime → client)

`event {seq, sessionId, type, ts, payload}`. These are **the same `seq` and types as the
durable event log** ([event-model.md](event-model.md)), filtered to UI-relevant types. In
addition there are **ephemeral** notifications that are not persisted and carry no `seq`:

- `stream.delta {turnId, kind: "text"|"thought_summary"|"tool_args", delta}` for live rendering,
- `permission.request {requestId, kind: "command"|"path"|"network"|"integrity"|"research"|"probe"|"privacy_change", detail, risk, reason}`,
- `progress {operation, message, fraction?}` (indexing, LSP start, long commands).

## Snapshot model

`SessionSnapshot` is a compact projection: session info, active task and state, plan, recent
turns (summarized), open permission requests, the last verification verdict, and running
processes. A client renders the snapshot, then applies events with `seq > snapshotSeq`. After a
reconnect it resubscribes with `afterSeq = lastSeenSeq`.

## Errors

JSON-RPC error codes are extended with Kai codes in `-32000…-32099`: `WORKSPACE_LOCKED`,
`SESSION_NOT_FOUND`, `TASK_NOT_ACTIVE`, `PERMISSION_EXPIRED`, `PROVIDER_UNAVAILABLE`,
`CONFIG_INVALID`, `ROUTE_UNAVAILABLE` (with the `RouteState`), `PROJECT_BUSY`,
`ENDPOINT_CHAT_ONLY`, `RESEARCH_UNAVAILABLE` (with the `ChromeStatus`), `OFFLINE_MODE`,
`STORE_READ_ONLY`. Error data carries `{retryable: boolean}`.

## Versioning

`protocolVersion` is a semver string (`0.2.0` with this extension). Before 1.0 a minor bump may
break; from 1.0 breaking changes bump the major version. The runtime supports the current and the
previous version line for one release. Capabilities, not versions, gate optional features (T3
Code's rule): `initialize` returns `capabilities.features` ⊇ {`routes`, `projects`, `learning`,
`research`, `endpoints`, `chatgptAuth`} when available; clients hide what is absent.

## Acceptance tests

1. A scripted client completes a task over the stdio transport using only KSP. A fake provider is
   allowed.
2. Disconnect mid-task, resubscribe with `afterSeq`, and the reconstructed client state equals a
   fresh subscription's state.
3. Permission round-trip: a deny decision results in a `function_result` with `is_error` reaching
   the model and no process being started.
4. Lint rule: `packages/cli` and `apps/macos` do not import runtime internals.
5. Credential-free property test: random secrets registered in a scripted session never appear
   in any KSP message other than the inbound `credentials.put` request.
6. A 0.1.0 client connecting to a 0.2.0 runtime gets the founding methods and no new features.
