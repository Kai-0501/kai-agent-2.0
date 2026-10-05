# Spec: Editing / Patch Engine

- Package: `packages/core` (`patch/`)
- Decisions: [ADR-0007](../adr/0007-editing-protocol.md), [ADR-0013](../adr/0013-workspace-safety-and-checkpoints.md), amended by [ADR-0016](../adr/0016-robustness-amendments.md)
- Collaborators: [Hallucination Firewall](hallucination-firewall.md), [Read Ledger](read-ledger.md), [Repo Index](repo-index.md), [Context Compiler](context-compiler.md) (instruction map), [event model](event-model.md), Checkpoint Manager

## Responsibility

Turn the model's edit calls into **validated, crash-safe, all-or-nothing, reversible
transactions** against the version of the code the model actually saw, and only after the
model has seen the project instructions that apply to the files it is changing.

**Not responsible for:** deciding *whether* an edit is semantically correct (the Firewall and the
Verification Engine do that), or formatting code (an optional post-apply formatter hook runs only
when it is configured in the profile).

## Lifecycle

```
model response with N edit calls
  └─► TransactionBuilder: collect edits in call order                  → TransactionProposed
        └─► INSTRUCTION GATE: applicable instruction files delivered?  → (no) TransactionRejected(instructions_pending) + instruction text
        └─► for each edit: resolve path, load base (overlay or disk), MATCH, apply to overlay
              └─► any match failure → reject whole txn                  → TransactionRejected (no disk change)
        └─► ledger version check (match ± 3 lines)                      → (stale) TransactionRejected(stale_view)
        └─► Firewall.evaluate(overlay, baseline)                        → FirewallEvaluated
              └─► verdict reject → discard overlay                      → TransactionRejected
        └─► Checkpoint (if the policy says so)                          → CheckpointCreated
        └─► PREPARE: before/after blobs durable, journal record durable → TransactionPrepared
        └─► STAGE: write + fsync temp files for every target
        └─► VERIFY: re-hash targets == before hashes?                   → (no) TransactionAborted(external_change), temps removed
        └─► SWAP: rename temps over targets / unlink deletes, fsync dirs
        └─► COMMIT marker                                               → TransactionApplied
        └─► Post-commit: index, ledger (edit_echo), LSP sync, optional formatter
        └─► Result per call: applied hunk / NOT APPLIED reason
```

Nothing touches the worktree before **PREPARE** is durable. From PREPARE until the COMMIT marker
(or an abort or rollback record), the transaction is **in flight**, and the
[recovery procedure](#crash-recovery) can complete or undo it from the journal alone.

## Data structures

```ts
type EditOp =
  | { kind: "replace"; toolCallId: ToolCallId; path: string; oldString: string; newString: string;
      allowMultiple: boolean; instruction: string }
  | { kind: "write"; toolCallId: ToolCallId; path: string; content: string; instruction?: string }
  | { kind: "delete"; toolCallId: ToolCallId; path: string; instruction: string }        // via multi_file_patch / rename only
  | { kind: "rename"; toolCallId: ToolCallId; from: string; to: string; instruction: string };

interface Overlay {
  get(path: string): { content: string; baseHash: ContentHash | null; exists: boolean };
  set(path: string, content: string): void;
  changedPaths(): string[];
}

interface MatchResult {
  status: "ok" | "not_found" | "ambiguous" | "stale_view";
  rung?: "exact" | "trailing_ws" | "indent_insensitive";
  ranges?: LineRange[];                 // where it matched
  candidates?: { range: LineRange; text: string; similarity: number }[];  // on failure, ≤ 3
}

/** The write-ahead journal record. Everything needed to finish OR undo the transaction. */
interface PreparedTransaction {
  txnId: TransactionId;
  checkpointId?: CheckpointId;
  order: string[];                      // paths in the exact order SWAP will process them
  files: {
    path: string;
    op: "create" | "modify" | "delete";          // a rename is a delete of `from` plus a create of `to`
    beforeHash: ContentHash | null;              // null = did not exist
    beforeBlob: ContentHash | null;              // full pre-image (null only for create)
    afterHash: ContentHash | null;               // null = must not exist afterwards (delete)
    afterBlob: ContentHash | null;               // full post-image (null only for delete)
    mode: number;                                // POSIX mode bits to restore or apply
    tempName: string;                            // ".<name>.kai-tmp-<txnId>-<n>" in the same directory
  }[];
  reversePatchBlob: ContentHash;
}

interface TransactionResult {
  txnId: TransactionId;
  status: "applied" | "rejected" | "aborted" | "rolled_back";
  perCall: { toolCallId: ToolCallId; message: string; hunk?: string; isError: boolean }[];
  firewall?: FirewallReport;
}
```

## Instruction gate

Before any matching work, for every target path (and both sides of a rename):

1. Look up the **applicable instruction files** in the instruction map: every `AGENTS.md`,
   `KAI.md` and `GEMINI.md` in the path's directory or any ancestor up to the workspace root
   ([context-compiler](context-compiler.md#project-instructions-instruction-map-and-pre-mutation-gate)).
2. For each one, ask the Read Ledger whether it has been delivered **in the current epoch at its
   current hash** (delivery kind `instructions`).
3. If any are missing, **reject the whole transaction** with `instructions_pending`. The result
   contains each missing instruction file's full text (recorded as a ledger delivery and counted
   under `project_instructions`), followed by: *"These instructions apply to the files you are
   editing and were not yet in your context. Nothing was written. Re-check your edit against them
   and resend it (changed or unchanged)."*
4. The resent transaction passes the gate, because the files are now delivered. The gate only
   ever fires once per (instruction file, hash, epoch).

The same gate guards `run_shell_command` when the policy classifies the command as mutating: the
paths checked are the command's `cwd` and any workspace paths appearing in its argv. If
instructions are pending, the command is **not run**, and the instructions are returned.

## Matching

Per `replace` op, against the **overlay** content (so sequential edits to the same file
compose):

1. **Normalize line endings** for matching (CRLF → LF). Remember the original style and restore
   it on write. Strip a BOM for matching and restore it on write.
2. **Rung 1, exact.** Count occurrences of `oldString`.
3. **Rung 2, trailing-whitespace-insensitive.** Compare line by line with `trimEnd`.
4. **Rung 3, indentation-insensitive.** Compare lines with leading whitespace stripped. On a
   unique match, compute the indentation delta between the matched first line and the
   `oldString` first line, and re-indent `newString` by that delta (spaces vs tabs preserved).
5. Exactly one match is required unless `allowMultiple`. With `allowMultiple`, all
   non-overlapping matches at the **same rung** are replaced.
6. **No fuzzy rung.** On `not_found`, compute up to 3 candidates: slide a window of
   `oldString`'s line count, and rank by normalized line-level similarity (longest common
   subsequence ratio over trimmed lines, minimum 0.5). Return each candidate's current text with
   line numbers.
7. **Empty `oldString`:** only valid when the file is empty or does not exist (treated as a
   create). Otherwise reject: *"old_string is empty; to insert, include adjacent anchor
   lines"*.
8. **No-op edit** (`oldString === newString`): reject with a hint. It is a common loop symptom
   and is counted.

## Version check (ledger)

After a unique match at `range` in the **disk** version (not text Kai added earlier in this same
transaction):
- `ledger.regionSeen(path, range ± 3 context lines, currentLines)`:
  - `seen_current` → ok;
  - `never_seen` → ok, counted as `blind_edit`. The exact match is evidence enough, and the
    firewall still validates;
  - `seen_stale` → **reject** with `stale_view`: *"src/a.ts lines 60–72 changed since you read
    them (turn 12). Current text: …"*. The current text is included if it is 400 tokens or less.

## Write ops

- `write` on a non-existent path → create, with parent directories created (recorded in the
  journal so rollback can remove directories Kai created). Path must be inside the workspace and
  not ignored by policy (e.g. `.git/`, `.kai/` internals).
- `write` on an existing file → full replace. If the file has more than 200 lines and the
  effective diff touches under 30% of its lines, the result includes the hint *"Most of this
  file was unchanged; prefer replace for targeted edits"* (counted as `wasteful_rewrite`). It is
  not blocked.

## Commit protocol (write-ahead journal)

**Invariant J1:** no workspace file is created, modified or deleted by a transaction unless a
durable `TransactionPrepared` record exists that holds **both** the full pre-image and the full
post-image of **every** file in the transaction.

1. **Checkpoint.** If the policy requires it (always, the first time each file is written in a
   task; by default before every transaction batch), create a workspace checkpoint (git ref,
   private index; [ADR-0013](../adr/0013-workspace-safety-and-checkpoints.md)). This is a second
   safety net, independent of the journal.
2. **PREPARE.**
   1. Write every before-blob and after-blob to the content-addressed blob store, `fsync` each
      blob file, and `fsync` the blob directories.
   2. Append the `TransactionPrepared` event, carrying the `PreparedTransaction` record, in a
      SQLite transaction committed with **`PRAGMA synchronous = FULL`** for that commit. The rest
      of the store may run at `NORMAL`, but the journal commit must survive power loss.
3. **STAGE.** For each target with an after-image, write `tempName` in the target's directory
   with the after-content and mode, then `fsync` it. No target has been touched yet.
4. **VERIFY.** Re-hash every target and compare with `beforeHash` (absent ⇔ null). On any
   mismatch (an external change since the overlay was built): delete all temps, append
   `TransactionAborted {reason: "external_change", paths}`, emit `ExternalChangeDetected`, and
   report every call as not applied. **Nothing was written.**
5. **SWAP**, in `order`: `rename(temp, target)` for creates and modifies, `unlink(target)` for
   deletes. Then `fsync` each affected directory (once per directory, after all its renames).
6. **COMMIT.** Append `TransactionApplied {txnId}`. This is the commit marker, and its absence is
   what recovery looks for.
7. **Cleanup.** Remove any leftover temp files for this `txnId`.
8. **In-process failure during SWAP** (an exception, not a crash): run the same procedure as
   [recovery](#crash-recovery) for this transaction immediately. That is roll back, unless every
   file is already in its after-state. Then report every call as not applied (or applied, if the
   transaction rolled forward).

## Crash recovery

Runs **at runtime start, before any other work on the workspace**, and on demand
(`kai recover`). It is also used for in-process SWAP failures. It is deterministic and
idempotent, and it reads only the journal and the disk.

For each `TransactionPrepared` with no `TransactionApplied`, `TransactionAborted` or
`TransactionRolledBack`:

1. **Remove stray temp files** matching `.kai-tmp-<txnId>-*`.
2. **Classify each file** by hashing the disk:
   - `AFTER`: matches `afterHash` (or absent when `afterHash` is null);
   - `BEFORE`: matches `beforeHash` (or absent when `beforeHash` is null);
   - `FOREIGN`: anything else (someone or something changed it).
   A file whose before and after are identical cannot occur (no-op files are excluded at
   PREPARE).
3. **Decide:**

| Disk state | Action | Recorded as |
|---|---|---|
| Every file `AFTER` | **Roll forward**: the swap completed and only the commit marker is missing. The content passed the firewall before PREPARE | `TransactionApplied {recovered: true}` |
| Every file `BEFORE` | Nothing was swapped. **Abort** | `TransactionAborted {reason: "crash_before_swap", recovered: true}` |
| A mix of `AFTER` and `BEFORE`, no `FOREIGN` | **Roll back**: for each `AFTER` file, restore the before-image from `beforeBlob` (temp + rename + fsync; unlink for files that did not exist; remove directories Kai created if empty) | `TransactionRolledBack {reason: "crash_mid_swap", recovered: true}` |
| Any `FOREIGN` | **Touch nothing.** The task becomes `blocked` (`recovery_conflict`), and the user chooses per file: keep disk / restore before / restore after (`recovery.resolve` in the [protocol](protocol.md)) | `RecoveryConflict {txnId, paths}` |

4. **Idempotence.** The rollback restore is itself just more renames toward known images. A crash
   during rollback leaves files in `BEFORE` or `AFTER`, so running recovery again re-classifies
   and finishes. No record other than the final one is needed.
5. **After recovery**, the ledger marks the affected paths stale. The interrupted task resumes
   only in a **new epoch**, whose brief states the outcome (*"txn_… was rolled back after an
   interrupted write; files X, Y are back to their pre-edit state"*).

## Post-commit

- Update the index for the changed files synchronously (the firewall already parsed them).
- Record `edit_echo` ledger entries for each changed hunk ±3 lines, and remap line numbers of
  other visible segments.
- Sync LSP documents to the new disk content.
- If configured, run the formatter on the changed files. Any additional diff it makes is shown to
  the model in the result (`formatted: +2/−2 lines`), and the ledger marks those regions as
  `formatter`-changed. A formatter write is a **separate journaled transaction**
  (`origin: "formatter"`).

## Result format (to the model)

```
Applied 3 edits in 2 files (txn_01J…):
• src/users/service.ts lines 51–58 → 51–61
   51| async findById(id: UserId): Promise<User | null> {
   52|+  if (!isValidId(id)) return null;
   …
• src/users/index.ts lines 3–3 → 3–4
Diagnostics: 0 introduced · 1 resolved (TS2304 'isValidId' in service.ts)
```

On rejection or abort, **every** call in the transaction gets `is_error: true` and a message
beginning with `NOT APPLIED`. The call that caused the rejection gets the details. The others
say *"not applied because the transaction was rejected (see call 2)"*.

## Rollback API (user-initiated undo)

`rollback(txnId)` runs as a **new journaled transaction** whose after-images are the original
before-images, valid if the current file hashes equal the transaction's `afterHash`. Otherwise it
uses a three-way merge with the before-blob, and refuses (reporting conflicts) if the merge is
not clean. `restoreCheckpoint(checkpointId, paths?)` is the bigger hammer, exposed to the user
via the protocol.

## Telemetry

`txn_applied`, `txn_rejected` by reason (`instructions_pending`, `not_found`, `ambiguous`,
`stale_view`, `firewall`, `noop`), `txn_aborted` (`external_change`), `match_rung` histogram,
`blind_edits`, `wasteful_rewrites`, `instruction_gate_rejections`,
`edit_retry_success_rate` (whether the next attempt after a rejection succeeds), bytes written,
PREPARE latency (the cost of `synchronous=FULL` and fsyncs), and recoveries by outcome.

## Acceptance tests

1. Two edits in one file in one response, with the second anchored on text the first produced,
   compose correctly.
2. Ambiguous `oldString` → rejected, with all match locations listed.
3. CRLF file: the edit applies, CRLF is preserved, and no other line changes.
4. Indentation-insensitive match re-indents a multi-line `newString` correctly (tabs and spaces).
5. A concurrent external modification between overlay build and VERIFY → `TransactionAborted
   (external_change)`, with no target touched.
6. `seen_stale`: read a region, then an external edit changes a line adjacent to the edit
   target (within the ±3-line context), then replace on the unchanged target line → stale
   rejection that includes the current text.
7. **Instruction gate:** an edit under a directory with an undelivered nested `AGENTS.md` →
   `instructions_pending` with its text. Nothing is written. The resend applies. A mutating
   shell command with that `cwd` is not run until the instructions are delivered.
8. **Crash-injection matrix.** A test harness kills the runtime process (SIGKILL) at each point
   below, for a 3-file transaction (create + modify + delete). On restart, recovery must produce
   the stated outcome, with every file byte-identical (content and mode) to the expected image:

| Kill point | Expected recovery outcome |
|---|---|
| K1 after blobs, before the PREPARE commit | No journal record → nothing to recover. Disk = before. Orphan blobs collected by `kai gc` |
| K2 after the PREPARE commit, before any temp | Aborted (`crash_before_swap`). Disk = before |
| K3 after the k-th temp write (k = 1..3) | Temps removed. Aborted. Disk = before |
| K4 after the 1st rename / unlink | Rolled back. Disk = before |
| K5 after the 2nd rename / unlink | Rolled back. Disk = before |
| K6 after the last swap, before COMMIT | Rolled forward (`TransactionApplied {recovered:true}`). Disk = after |
| K7 during rollback, after the j-th restore | Second recovery run finishes the rollback. Disk = before |
| K8 any of K4/K5 **plus** an external edit to one file before restart | `RecoveryConflict`. Nothing touched. Task `blocked` (`recovery_conflict`) |

   Each case also asserts that `kai db rebuild` gives consistent projections afterwards, and that
   the resumed task starts a new epoch whose brief mentions the recovery.
9. Power-loss durability is spot-checked on Linux with a block-level crash-simulation harness
   (e.g. `dm-log-writes` replay of every crash point) in nightly CI, not per commit.
