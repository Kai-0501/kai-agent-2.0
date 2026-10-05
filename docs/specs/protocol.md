# Spec: Kai Session Protocol (KSP)

- Package: `packages/protocol`
- Decision: [ADR-0002](../adr/0002-runtime-client-boundary.md)

## Responsibility

KSP is the only contract between the **Kai Runtime**, which owns the workspace, model calls and
state, and **clients** (the CLI/TUI in v1; later desktop/web, the benchmark harness, and an ACP
adapter). Clients never access the filesystem, git, processes or credentials directly.

**Not responsible for:** rendering, authentication for remote transports (post-v1), or provider
APIs.

## Transport and framing

- JSON-RPC 2.0 semantics: `request {id, method, params}` → `response {id, result | error}`.
  Notifications have no `id`.
- v1 transports:
  - `InMemoryTransport`: the CLI hosts the runtime in-process.
  - `StdioTransport`: newline-delimited JSON, used by the headless runner and the benchmark
    harness.
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

## Notifications (runtime → client)

`event {seq, sessionId, type, ts, payload}`. These are **the same `seq` and types as the
durable event log** ([event-model.md](event-model.md)), filtered to UI-relevant types. In
addition there are **ephemeral** notifications that are not persisted and carry no `seq`:

- `stream.delta {turnId, kind: "text"|"thought_summary"|"tool_args", delta}` for live rendering,
- `permission.request {requestId, kind, command|path, risk, reason}`,
- `progress {operation, message, fraction?}` (indexing, LSP start, long commands).

## Snapshot model

`SessionSnapshot` is a compact projection: session info, active task and state, plan, recent
turns (summarized), open permission requests, the last verification verdict, and running
processes. A client renders the snapshot, then applies events with `seq > snapshotSeq`. After a
reconnect it resubscribes with `afterSeq = lastSeenSeq`.

## Errors

JSON-RPC error codes are extended with Kai codes in `-32000…-32099`: `WORKSPACE_LOCKED`,
`SESSION_NOT_FOUND`, `TASK_NOT_ACTIVE`, `PERMISSION_EXPIRED`, `PROVIDER_UNAVAILABLE`,
`CONFIG_INVALID`. Error data carries `{retryable: boolean}`.

## Versioning

`protocolVersion` is a semver string. Breaking changes bump the major version. The runtime
supports the current and previous major for one release. Capabilities, not versions, gate
optional features (T3 Code's rule).

## Acceptance tests

1. A scripted client completes a task over the stdio transport using only KSP. A fake provider is
   allowed.
2. Disconnect mid-task, resubscribe with `afterSeq`, and the reconstructed client state equals a
   fresh subscription's state.
3. Permission round-trip: a deny decision results in a `function_result` with `is_error` reaching
   the model and no process being started.
4. Lint rule: `packages/cli` does not import runtime internals.
