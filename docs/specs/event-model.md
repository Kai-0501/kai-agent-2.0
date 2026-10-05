# Spec: Event model and Session Store

- Package: `packages/core` (`store/`, `events/`)
- Decision: [ADR-0004](../adr/0004-durable-event-session-model.md)

## Responsibility

- Durably record **everything that happened** in a session as an append-only event log.
- Maintain **projections** for fast queries: ledger, artifacts, transactions, verification runs,
  attempts, turn usage and tasks.
- Store large payloads as content-addressed **blobs**.
- Provide the **single ordering** (`seq`) shared by storage, the protocol stream and telemetry.

**Not responsible for:** deciding what the model sees (that is the
[Context Compiler](context-compiler.md)), or business logic of subsystems (they *emit* events and
*read* projections).

## Identifiers

All IDs are app-owned (T3 Code's rule). Provider IDs are stored as references.

| ID | Format | Scope |
|---|---|---|
| `WorkspaceId` | `ws_` + 12 hex chars of SHA-256(canonical root + first commit) | per repository clone |
| `SessionId` | `ses_` + ULID | per session |
| `TaskId` | `tsk_` + ULID | one user request and its follow-ups until a final verdict |
| `EpochId` | `ep_` + ULID | one context epoch |
| `TurnId` | `trn_` + ULID | one model request/response |
| `ToolCallId` | `call_` + ULID; the provider call ID is stored as `providerCallId` | one function call |
| `TransactionId` | `txn_` + ULID | one edit transaction |
| `ArtifactId` | `art_` + 8 base32 chars (short; shown to the model) | one spooled output |
| `CheckpointId` | `chk_` + ULID; git ref `refs/kai/checkpoints/<ses>/<n>` | one workspace checkpoint |
| `VerificationRunId` | `ver_` + ULID | one gate or tier run |
| `ContentHash` | SHA-256 hex | file contents, blobs |

## Storage schema (SQLite, WAL)

```sql
CREATE TABLE events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  task_id    TEXT,
  epoch_id   TEXT,
  turn_id    TEXT,
  type       TEXT NOT NULL,
  v          INTEGER NOT NULL DEFAULT 1,   -- payload schema version
  ts         TEXT NOT NULL,                -- ISO 8601
  payload    TEXT NOT NULL,                -- JSON, validated per type
  blob_refs  TEXT                          -- JSON array of ContentHash
);
CREATE INDEX events_session_seq ON events(session_id, seq);
CREATE INDEX events_type ON events(session_id, type);

-- Projections (rebuildable from events)
CREATE TABLE tasks (task_id TEXT PRIMARY KEY, session_id TEXT, state TEXT, objective TEXT,
                    acceptance_json TEXT, risk_json TEXT, created_seq INTEGER, updated_seq INTEGER);
CREATE TABLE ledger_reads (session_id TEXT, epoch_id TEXT, turn_id TEXT, path TEXT,
                           content_hash TEXT, start_line INTEGER, end_line INTEGER,
                           symbol TEXT, delivery TEXT,      -- full|range|outline|stub|diff
                           est_tokens INTEGER, seq INTEGER);
CREATE TABLE file_versions (session_id TEXT, path TEXT, content_hash TEXT, source TEXT, -- read|kai_write|external
                            blob TEXT, seq INTEGER);
CREATE TABLE artifacts (artifact_id TEXT PRIMARY KEY, session_id TEXT, kind TEXT, command TEXT,
                        exit_code INTEGER, bytes INTEGER, lines INTEGER, blob TEXT,
                        summary_json TEXT, seq INTEGER);
CREATE TABLE transactions (txn_id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, status TEXT,
                           files_json TEXT, firewall_json TEXT, reverse_patch_blob TEXT, seq INTEGER);
CREATE TABLE verification_runs (run_id TEXT PRIMARY KEY, task_id TEXT, tier TEXT, check_id TEXT,
                                status TEXT, classification TEXT, artifact_id TEXT,
                                fingerprints_json TEXT, seq INTEGER);
CREATE TABLE attempts (task_id TEXT, attempt_no INTEGER, failure_fp TEXT, approach_fp TEXT,
                       txn_ids_json TEXT, outcome TEXT, seq INTEGER);
CREATE TABLE turn_usage (turn_id TEXT PRIMARY KEY, session_id TEXT, epoch_id TEXT, model TEXT,
                         thinking_level TEXT, state_mode TEXT, input_tokens INTEGER,
                         cached_tokens INTEGER, thought_tokens INTEGER, output_tokens INTEGER,
                         tool_use_tokens INTEGER, total_tokens INTEGER, manifest_json TEXT,
                         counters_json TEXT, latency_ms INTEGER, ttft_ms INTEGER, seq INTEGER);
```

The index tables (`files`, `symbols`, `refs`, `imports`) live in the same DB but are **derived
caches**, not projections. They are rebuilt from the filesystem, not from events
([repo-index.md](repo-index.md)).

Blobs: `<data>/blobs/<hh>/<hash>.zst`, written before the event that refers to them
(write-ahead). Blobs that no event refers to are collected by `kai gc`.

## Event catalog (v1)

Each event type has a Zod payload schema. Payloads list the essential fields (`…` means
additional optional fields).

**Session and task**
- `SessionStarted {workspaceId, model, config, runtimeVersion, providerCapabilities}`
- `SessionEnded {reason}`
- `UserMessage {taskId?, text, attachments?}` / `SteeringMessage {taskId, text}`
- `TaskCreated {taskId, objective, acceptance[], scopeHints[]}`
- `TaskStateChanged {taskId, from, to, reason, evidenceRef?}`

**Context**
- `EpochStarted {epochId, reason: "task_start"|"soft_limit"|"hard_limit"|"phase"|"replan"|"resume"|"model_switch", previousEpochId?}`
- `EpochBriefBuilt {epochId, briefBlob, sections: {name, estTokens}[], llmDigestUsed: boolean}`
- `ToolLoadoutChanged {epochId, declarationsHash, tools[], packs[]}`
- `PromptVersioned {systemPromptHash, projectInstructionsHash, blobRefs}`
- `ContextElided {epochId, turnRange, estTokensFreed}` (stateless mode only)

**Model**
- `ModelRequest {turnId, epochId, provider, model, stateMode, previousInteractionRef?, thinkingLevel, allowedTools?, inputManifest, inputBlob, declarationsHash, generationConfig}`
- `ModelResponse {turnId, status, steps: CanonicalStep[], providerRefs: {interactionId?}, usage, latencyMs, ttftMs}`
- `ModelError {turnId, kind, retryable, attempt, message}`
- `ReasoningDecision {turnId, level, inputs, rule}` (the Governor's audit trail)

**Tools**
- `ToolCallRequested {toolCallId, providerCallId, name, args}`
- `PermissionRequested {requestId, toolCallId, kind, detail, risk}` / `PermissionResolved {requestId, decision, by: "user"|"policy"}`
- `ToolCallCompleted {toolCallId, ok, resultForModel, resultEstTokens, artifactIds[], counters}`
- `SourceRead {toolCallId, path, contentHash, ranges[], symbol?, delivery, estTokens}`
- `ProcessStarted {pid, argv, cwd, background}` / `ProcessExited {pid, exitCode, signal?, durationMs, artifactId}`

**Edits and workspace**
- `TransactionProposed {txnId, turnId, edits: EditOp[]}`
- `FirewallEvaluated {txnId, verdict: "pass"|"reject"|"pass_with_warnings", findings[]}`
- `TransactionApplied {txnId, files: {path, beforeHash, afterHash}[], reversePatchBlob}`
- `TransactionRejected {txnId, reason, findings[]}`
- `TransactionRolledBack {txnId, reason}`
- `CheckpointCreated {checkpointId, gitRef, reason}` / `CheckpointRestored {checkpointId, paths[]}`
- `ExternalChangeDetected {paths[], detectedBy: "watcher"|"hash_check"}`

**Diagnostics, verification and integrity**
- `DiagnosticsSnapshot {scope, files[], introduced[], resolved[], source: "lsp"|"treesitter"|"command"}`
- `VerificationRequested {taskId, trigger: "complete_task"|"user"|"policy"}`
- `VerificationRunCompleted {runId, tier, checkId, status, classification?, artifactId, fingerprints[]}`
- `TaskVerdict {taskId, state, evidence: EvidenceBundle}`
- `IntegrityFinding {taskId, txnId?, kind, severity, detail, justified?}`

**Repair and critic**
- `FailureFingerprinted {taskId, fp, kind, sample}`
- `RepairAttemptRecorded {taskId, attemptNo, failureFp, approachFp, outcome}`
- `StuckDetected {taskId, rule, evidence}`
- `ReplanStarted {taskId, briefBlob}`
- `CriticRequested {taskId, triggers[]}` / `CriticCompleted {taskId, findings[], blocking: boolean, usage}`

## Invariants (tested)

1. `seq` is strictly increasing. Events are never updated or deleted while a session exists.
2. Each event and its projection updates commit in **one SQLite transaction**.
3. `kai db rebuild` produces byte-identical projections from events.
4. Every `ToolCallRequested` gets exactly one `ToolCallCompleted` (an error result counts),
   including after a crash: on recovery, synthesized `ToolCallCompleted {ok:false,
   resultForModel: "interrupted"}` events are added.
5. Every `ModelRequest` can be reproduced from `inputBlob` + `declarationsHash` +
   `generationConfig`.
6. Blobs are written before the events that refer to them.

## Recovery

On startup with a session that has no `SessionEnded`: close any dangling tool calls (invariant
4), check workspace hashes against the last `TransactionApplied` per file, emit
`ExternalChangeDetected` on mismatch, and mark the active task `blocked` with a recovery
summary until the user resumes. A chained provider state is treated as lost: resume starts a new
epoch.

## Acceptance tests

- A property test: random event sequences give rebuild-equality.
- A crash injection (kill between blob write and event insert, or between event insert and the
  next action) leaves the store consistent.
- Performance: append plus projection update p95 under 2 ms on a laptop SSD. Ledger lookup by
  `(session, path)` p95 under 1 ms.
