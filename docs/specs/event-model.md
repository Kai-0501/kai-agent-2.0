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
CREATE TABLE task_contracts (task_id TEXT, version INTEGER, entries_json TEXT, instruction_files_json TEXT,
                             hash TEXT, seq INTEGER, PRIMARY KEY (task_id, version));
CREATE TABLE inflight_transactions (txn_id TEXT PRIMARY KEY, prepared_seq INTEGER);  -- rows removed by the terminal event's projection update
CREATE TABLE flake_history (test_id TEXT, checkpoint_commit TEXT, passed INTEGER, failed INTEGER, seq INTEGER);
CREATE TABLE tasks (task_id TEXT PRIMARY KEY, session_id TEXT, state TEXT, blocked_reason TEXT,
                    contract_version INTEGER, risk_json TEXT, created_seq INTEGER, updated_seq INTEGER);
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
- `TaskCreated {taskId, scopeHints[]}` (the objective and acceptance live only in the contract)
- `TaskContractRecorded {taskId, contract}` and `TaskContractAmended {taskId, version, entry, by: "user"}`.
  These are user-owned requirements ([task-contract](task-contract.md)). Only KSP handlers for
  user actions can emit them.
- `TaskStateChanged {taskId, from, to, reason, evidenceRef?}`

**Context**
- `EpochStarted {epochId, reason: "task_start"|"soft_limit"|"hard_limit"|"phase"|"replan"|"resume"|"model_switch", previousEpochId?}`
- `EpochBriefBuilt {epochId, briefBlob, sections: {name, estTokens}[], llmDigestUsed: boolean}`
- `ToolLoadoutChanged {epochId, declarationsHash, tools[], packs[]}`
- `PromptVersioned {systemPromptHash, projectInstructionsHash, blobRefs}`
- `ContextElided {epochId, turnRange, estTokensFreed}` (stateless mode only)
- `InstructionsIndexed {files: {path, scopeDir, hash, estTokens}[]}` / `InstructionFilesChanged {paths, hashes}`
- `PreflightDecision {turnId, projectedInputTokens, breakdown, action: "send"|"send_then_rollover"|"reshape"|"rollover_now", reshapedItems?}`

**Model**
- `ModelRequest {turnId, epochId, provider, model, stateMode, previousInteractionRef?, thinkingLevel, allowedTools?, inputManifest, inputBlob, declarationsHash, generationConfig}`
  (`inputManifest` is the **complete** accounting of the request, including model-generated
  history; see [context-compiler](context-compiler.md#complete-request-accounting))
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
- `TransactionRejected {txnId, reason, findings[]}` (before PREPARE; nothing written. The reasons include `instructions_pending`)
- `TransactionPrepared {txnId, prepared: PreparedTransaction}`: the **write-ahead journal
  record**, holding every file's before and after hashes and blobs, modes, temp names and swap
  order ([patch-engine](patch-engine.md#commit-protocol-write-ahead-journal)). Committed with
  `synchronous=FULL`.
- `TransactionApplied {txnId, recovered?: boolean}`: the commit marker
- `TransactionAborted {txnId, reason: "external_change"|"crash_before_swap", recovered?: boolean}`: nothing was written
- `TransactionRolledBack {txnId, reason, recovered?: boolean}`: every file is back to its before-image
- `RecoveryConflict {txnId, paths[]}` / `RecoveryResolved {txnId, choices: {path, choice}[], by: "user"}`
- `CheckpointCreated {checkpointId, gitRef, reason}` / `CheckpointRestored {checkpointId, paths[]}`
- `ExternalChangeDetected {paths[], detectedBy: "watcher"|"hash_check"}`

**Diagnostics, verification and integrity**
- `DiagnosticsSnapshot {scope, files[], introduced[], resolved[], source: "lsp"|"treesitter"|"command"}`
- `VerificationRequested {taskId, trigger: "complete_task"|"user"|"policy"}`
- `VerificationRunCompleted {runId, tier, checkId, status, classification?, artifactId, fingerprints[]}`
- `TaskVerdict {taskId, state, evidence: EvidenceBundle}`
- `IntegrityFinding {taskId, txnId?, kind, severity, detail, status: "unbacked"|"contract_backed", citation?}`
- `IntegrityReviewResolved {findingId, by: "critic"|"user", outcome}`
- `BaselineRunCompleted {checkpointCommit, testId, passed, failed}`: feeds `flake_history` (baseline states only)

**Repair and critic**
- `FailureFingerprinted {taskId, fp, kind, sample}`
- `RepairAttemptRecorded {taskId, attemptNo, failureFp, approachFp, outcome}`
- `StuckDetected {taskId, rule, evidence}`
- `ReplanStarted {taskId, briefBlob}`
- `CriticRequested {taskId, mode: "risk_review"|"integrity_review", triggers[]}` / `CriticCompleted {taskId, mode, findings[], blocking: boolean, budgetExhausted: boolean, usage}`

## Invariants (tested)

1. `seq` is strictly increasing. Events are never updated or deleted while a session exists.
2. Each event and its projection updates commit in **one SQLite transaction**.
3. `kai db rebuild` produces byte-identical projections from events.
4. Every `ToolCallRequested` gets exactly one `ToolCallCompleted` (an error result counts),
   including after a crash: on recovery, synthesized `ToolCallCompleted {ok:false,
   resultForModel: "interrupted"}` events are added.
5. Every `ModelRequest` can be reproduced from `inputBlob` + `declarationsHash` +
   `generationConfig`.
6. Blobs are written (and, for journal blobs, fsynced) before the events that refer to them.
7. **J1:** no workspace file is changed by a transaction unless a durable `TransactionPrepared`
   holding the full before- and after-images of every file in it was committed first. Every
   `TransactionPrepared` eventually gets exactly one of `TransactionApplied`,
   `TransactionAborted`, `TransactionRolledBack` or `RecoveryConflict` (and, after a conflict, a
   `RecoveryResolved`).
8. Only user-action protocol handlers can emit `TaskContract*` events, `IntegrityReviewResolved
   {by: "user"}`, `RecoveryResolved` and `PermissionResolved {by: "user"}`.

**Durability settings:** WAL mode with `synchronous=NORMAL` for ordinary appends (durable
against process crashes). The `TransactionPrepared` commit (and any commit that must survive
power loss before an external side effect) switches the connection to `synchronous=FULL` for
that commit.

## Recovery

On startup, **before any other work on the workspace**, in this order:
1. **Transaction recovery:** for every `TransactionPrepared` without a terminal record, run the
   Patch Engine's [crash-recovery procedure](patch-engine.md#crash-recovery) (roll forward,
   abort, roll back, or `RecoveryConflict`). It is deterministic, idempotent, and uses only the
   journal and the disk.
2. **Dangling tool calls:** synthesize `ToolCallCompleted {ok:false, resultForModel:
   "interrupted"}` (invariant 4).
3. **External changes:** compare workspace hashes with the last applied after-image per file, and
   emit `ExternalChangeDetected` on mismatch.
4. **Task state:** for a session without `SessionEnded`, mark the active task `blocked`
   (`recovery_conflict` if step 1 found a conflict, otherwise `needs_user`), with a recovery
   summary, until the user resumes. A chained provider state is treated as lost: resume starts a
   new epoch whose brief reports the recovery outcomes.

## Acceptance tests

- A property test: random event sequences give rebuild-equality.
- Journal recovery: the Patch Engine's crash-injection matrix (K1–K8) passes, and after each
  case invariant J1 holds and `inflight_transactions` is empty or holds only a `RecoveryConflict`.
- A crash injection (kill between blob write and event insert, or between event insert and the
  next action) leaves the store consistent.
- Performance: append plus projection update p95 under 2 ms on a laptop SSD (excluding
  `synchronous=FULL` journal commits, which are measured separately). Ledger lookup by
  `(session, path)` p95 under 1 ms.
