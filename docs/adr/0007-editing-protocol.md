# ADR-0007: Editing protocol

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/patch-engine.md](../specs/patch-engine.md), [specs/hallucination-firewall.md](../specs/hallucination-firewall.md), [specs/tool-surface.md](../specs/tool-surface.md), [research/upstream/gemini-cli.md](../research/upstream/gemini-cli.md), [research/upstream/swe-agent.md](../research/upstream/swe-agent.md), [research/upstream/codex-and-serena.md](../research/upstream/codex-and-serena.md)

## Context / problem

Edits must be cheaper than regenerating files, must apply unambiguously to the version the model
believes it is editing, must be validated before they reach the worktree, and must be reversible.
Edit *format* also affects code quality (Aider's laziness study) and model reliability
(in-distribution tool shapes).

## Considered alternatives

| Format | Token cost | Ambiguity risk | Gemini familiarity | Notes |
|---|---|---|---|---|
| Whole-file write | High | None | High (`write_file`) | Invites "lazy" omissions; expensive for big files |
| `old_string`/`new_string` replace | Low | Must be unique | **High** (Gemini CLI `replace`) | Gemini-3 tool family shape |
| Multi-edit replace (Pi) | Low | Must be unique; matched on the original | Medium | Atomic multi-site edits |
| Unified diff | Low/medium | Line-number drift | Medium | Aider found it reduced laziness for GPT-4 Turbo |
| `apply_patch` (Codex) | Low | Context anchors | Low (GPT-trained) | Best multi-file envelope |
| AST/symbol edits (Serena) | Low | None if the symbol resolves | Low | Needs LSP or tree-sitter; out-of-distribution |
| Line-range edits | Lowest | **High** (stale line numbers) | Medium | Unsafe without version checks |

Matching strategies: exact; whitespace-normalized; regex; fuzzy (Levenshtein or
`SequenceMatcher`); LLM correction (Gemini CLI).

## Decision

1. **Primary edit tool: `replace`** in Gemini CLI's Gemini-3 shape: `file_path`, `old_string`,
   `new_string`, `allow_multiple` (default false), `instruction` (one sentence of intent). New
   files and deliberate full rewrites use **`write_file`**. Full rewrites of existing files over
   200 lines are flagged for scope review.
2. **Transactions.** All edit calls in **one model response** form one **transaction**. They are
   applied in order to an **in-memory overlay** of the affected files, validated as a whole by
   the Hallucination Firewall, and then committed atomically to disk or rejected as a whole.
   Each edit's `old_string` is matched against the overlay *as of that edit*, so sequential edits
   to one file compose. Overlapping edits inside one call are rejected.
3. **Matching ladder** (Codex-style, **no fuzzy**):
   1. exact;
   2. trailing-whitespace-insensitive;
   3. leading-and-trailing-whitespace-insensitive, re-indenting `new_string` by the indentation
      delta.
   Any match must be **unique** unless `allow_multiple`. On failure, the result lists up to 3
   closest candidate regions (by line-similarity ranking) with line numbers and current text
   (Aider's "did you mean"), and **nothing is applied**.
4. **Version checks via the Read Ledger.** Kai knows which version of each range the model has
   seen. If the matched region's current text differs from the model's last-seen version of that
   region (the file changed underneath), the edit is rejected with a fresh excerpt. Edits to
   regions the model never read but whose `old_string` matches exactly are allowed and logged
   (`blind_edit`) for telemetry.
5. **Commit.** Write each file to a temp file and `rename` it atomically. Record a
   `TransactionApplied` event with before and after hashes and a **reverse patch** (as a blob).
   Line endings and BOMs are preserved. If a mid-commit failure happens on file N, roll back
   files 1..N-1 from their before-blobs.
6. **Feedback.** The edit result is short: the applied hunk(s) with line numbers and a few
   context lines, plus firewall and diagnostic deltas. This doubles as a ledger read of the new
   region, so the model's view stays current without a re-read.
7. **Optional packs**, behind the benchmark gate ([ADR-0014](0014-measurement-gated-mechanisms.md)):
   `multi_file_patch` (Codex `apply_patch` grammar) and `symbol_edit` (`replace_symbol_body`,
   `insert_after_symbol`, `rename_symbol` via LSP).

## Rationale

The Gemini-3 `replace` shape is what Gemini was tuned on, it is token-cheap, and its uniqueness
requirement doubles as a version check. Transactions solve the cross-file refactor problem: they
validate the *set* of changes, not each edit alone. Strict matching trades the occasional extra
turn for never applying an edit somewhere the model did not intend. Fuzzy and LLM-corrected
application are exactly the kind of silent "trust the model" step Kai exists to remove.

## Consequences

- The match-failure rate is a key metric. If it is high on Gemini, improve failure messages
  first. Only then consider an opt-in looser rung, still never fuzzy edit-distance application.
- Overlay-based validation needs LSP support for unsaved buffers, which all mainstream servers
  provide.
- The model cannot pass hashes, and does not need to. The ledger does the version check
  invisibly.

## Unresolved questions

1. Should `replace` accept Pi-style `edits[]` batches in one call (fewer function calls), or is
   relying on parallel function calls enough? Benchmark it.
2. Does Gemini 3.8 Flash write good `instruction` strings cheaply, or should the field become
   optional? It is used for scope review, the brief and the critic.
3. CRLF and mixed line endings: normalize for matching and restore on write. Needs tests.
