# Spec: Editing / Patch Engine

- Package: `packages/core` (`patch/`)
- Decision: [ADR-0007](../adr/0007-editing-protocol.md), [ADR-0013](../adr/0013-workspace-safety-and-checkpoints.md)
- Collaborators: [Hallucination Firewall](hallucination-firewall.md), [Read Ledger](read-ledger.md), [Repo Index](repo-index.md), Checkpoint Manager

## Responsibility

Turn the model's edit calls into **validated, atomic, reversible transactions** against the
version of the code the model actually saw.

**Not responsible for:** deciding *whether* an edit is semantically correct (the Firewall and the
Verification Engine do that), or formatting code (an optional post-apply formatter hook runs only
when it is configured in the profile).

## Lifecycle

```
model response with N edit calls
  └─► TransactionBuilder: collect edits in call order          → TransactionProposed
        └─► for each edit: resolve path, load base (overlay or disk), MATCH, apply to overlay
              └─► any match failure → reject whole txn          → TransactionRejected (no disk change)
        └─► Firewall.evaluate(overlay, baseline)                → FirewallEvaluated
              └─► verdict reject → discard overlay              → TransactionRejected
        └─► Checkpoint (if the policy says so)                  → CheckpointCreated
        └─► Commit: hash-check every target vs last known, write temp + rename
              └─► mid-commit failure → restore written files    → TransactionRolledBack
        └─► Post-commit: update index, ledger (edit_echo), LSP sync, optional formatter
                                                                → TransactionApplied
        └─► Result per call: applied hunk / NOT APPLIED reason
```

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

interface TransactionResult {
  txnId: TransactionId;
  status: "applied" | "rejected" | "rolled_back";
  perCall: { toolCallId: ToolCallId; message: string; hunk?: string; isError: boolean }[];
  firewall?: FirewallReport;
}
```

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

- `write` on a non-existent path → create, with parent directories created. Path must be inside
  the workspace and not ignored by policy (e.g. `.git/`, `.kai/` internals).
- `write` on an existing file → full replace. If the file has more than 200 lines and the
  effective diff touches under 30% of its lines, the result includes the hint *"Most of this
  file was unchanged; prefer replace for targeted edits"* (counted as `wasteful_rewrite`). It is
  not blocked.

## Commit protocol

1. For each target path: read the current disk bytes and hash them. Compare with the expected
   **pre-transaction hash** (the base the overlay was built from). On mismatch → reject the whole
   transaction with `external_change`, and emit `ExternalChangeDetected`.
2. If the policy requires (always, the first time each file is written in a task; and before
   every transaction batch by default), create a **workspace checkpoint** (git ref, private
   index; [ADR-0013](../adr/0013-workspace-safety-and-checkpoints.md)).
3. Write each file to `<dir>/.<name>.kai-tmp-<rand>`, `fsync`, then `rename` over the target.
   Preserve file mode.
4. If any write fails, restore every already-renamed file from its before-blob, emit
   `TransactionRolledBack`, and report all calls as not applied.
5. Store the **reverse patch** (a unified diff from after to before) as a blob in
   `TransactionApplied`.

## Post-commit

- Update the index for the changed files synchronously (the firewall already parsed them).
- Record `edit_echo` ledger entries for each changed hunk ±3 lines, and remap line numbers of
  other visible segments.
- Sync LSP documents to the new disk content.
- If configured, run the formatter on the changed files. Any additional diff it makes is shown to
  the model in the result (`formatted: +2/−2 lines`), and the ledger marks those regions as
  `formatter`-changed.

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

On rejection, **every** call in the transaction gets `is_error: true` and a message beginning
with `NOT APPLIED`. The call that caused the rejection gets the details. The others say
*"not applied because the transaction was rejected (see call 2)"*.

## Rollback API

`rollback(txnId)` applies the reverse patch if the current file hashes equal the transaction's
`afterHash`. Otherwise it uses a three-way merge with the before-blob, and refuses (reporting
conflicts) if the merge is not clean. `restoreCheckpoint(checkpointId, paths?)` is the bigger
hammer, exposed to the user via the protocol.

## Telemetry

`txn_applied`, `txn_rejected` by reason (`not_found`, `ambiguous`, `stale_view`, `firewall`,
`external_change`, `noop`), `match_rung` histogram, `blind_edits`, `wasteful_rewrites`,
`edit_retry_success_rate` (whether the next attempt after a rejection succeeds), and bytes
written.

## Acceptance tests

1. Two edits in one file in one response, with the second anchored on text the first produced,
   compose correctly.
2. Ambiguous `oldString` → rejected, with all match locations listed.
3. CRLF file: the edit applies, CRLF is preserved, and no other line changes.
4. Indentation-insensitive match re-indents a multi-line `newString` correctly (tabs and spaces).
5. A concurrent external modification between overlay build and commit → `external_change`,
   with no partial writes.
6. Fault injection: the second file's rename fails → the first is restored, byte-identical.
7. `seen_stale`: read a region, then an external edit changes a line adjacent to the edit
   target (within the ±3-line context), then replace on the unchanged target line → stale
   rejection that includes the current text.
