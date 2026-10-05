# Aider

- **Repository:** [Aider-AI/aider](https://github.com/Aider-AI/aider) @ `5dc9490b` (2026-05-22. Commit activity has slowed noticeably compared with the other projects.)
- **License:** Apache-2.0
- **Language/runtime:** Python. tree-sitter via `grep_ast`, `networkx` PageRank, `diskcache` (SQLite) tag cache, LiteLLM for providers.
- **Studied as:** inspiration for repository maps, relevance selection, token-budgeted context and efficient editing.

## Architecture

A chat-centric pair programmer. The user adds files to the chat explicitly. The **repo map**
supplies everything else as signatures. A `Coder` subclass per edit format
([`aider/coders/`](https://github.com/Aider-AI/aider/tree/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders))
parses the model's text response into edits. There is no function calling in the classic
formats: edits are parsed from markdown.

## Context management: the repository map

[`aider/repomap.py`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py)
is the most transferable idea in the whole survey.

1. **Tag extraction.** tree-sitter `tags.scm` queries extract *definitions* and *references* per
   file. Results are cached in SQLite (`diskcache`) keyed by path and invalidated by `mtime`.
2. **Graph.** Each referencing file links to each defining file, per identifier. Edge weights
   are tuned by heuristics: ×10 if the identifier was mentioned in chat, ×10 for long
   snake/camel/kebab identifiers (≥ 8 chars), ×0.1 for `_private` names, ×0.1 for identifiers
   defined in more than 5 places, ×50 if the referencing file is in the chat, and `sqrt(count)`
   damping
   ([L480–517](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py#L480-L517)).
3. **Personalized PageRank** (`networkx.pagerank`) seeded by chat files and mentioned
   identifiers
   ([L525](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/repomap.py#L525)).
   Rank is distributed from files to their definitions.
4. **Budget fit.** A binary search finds how many top-ranked tags fit `max_map_tokens`, accepting
   anything within 15% of target. The default budget is 1k tokens, multiplied by
   `map_mul_no_files=8` when no files are in the chat
   ([website docs](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/docs/repomap.md)).
5. **Rendering.** `grep_ast.TreeContext` prints only the lines of interest (definition
   signatures) with their enclosing scopes and elides bodies.

**Chat history** is summarized by a weaker model once it exceeds a token limit, recursively
splitting head and tail
([`aider/history.py`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/history.py)).

## Editing

Many formats exist, each trading reliability against token cost:

- **SEARCH/REPLACE blocks** (`editblock`). Matching tries, in order: exact; ignoring leading
  whitespace; handling `...` elisions; and finally the closest chunk by `SequenceMatcher` ratio
  ≥ 0.8. On failure it returns *"SearchReplaceNoExactMatch … Did you mean to match some of these
  actual lines…"* together with the most similar real lines
  ([`editblock_coder.py`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/editblock_coder.py)).
- **Unified diff** (`udiff`). Aider found that unified diffs made GPT-4 Turbo "3X less lazy" on
  its laziness benchmark
  ([`unified-diffs.md`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/website/docs/unified-diffs.md)).
  The lesson: **edit format affects code quality, not just token cost**.
- **Whole file**: simple and expensive.
- **Architect mode**: a strong model plans and a cheaper "editor" model writes the edits.

## Verification: the lint/test reflection loop

After applying edits, Aider auto-lints the edited files and optionally runs the test command.
Failures become a *reflected message*, a new user turn, for at most **3 reflections**
([`base_coder.py`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py),
`max_reflections = 3`). The linter
([`linter.py`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/linter.py))
combines:
- `basic_lint`: tree-sitter parse, reporting any `ERROR` nodes. It works for **every** language
  with a grammar
  ([L201](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/linter.py#L201)).
- `py_compile` plus `flake8` (a fatal-errors subset) for Python, or a user-configured lint
  command.
- `tree_context`: errors are shown *with their enclosing code structure*, not as bare line
  numbers
  ([L234](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/linter.py#L234)).

The edits are applied **before** linting, and the model is asked to fix any problems afterwards.
Errors are *reported*, not *prevented*.

## Session state

Git is the session record. Aider auto-commits each change with a generated message, and `/undo`
reverts the last commit. Chat history is persisted as markdown. There is no structured event log.

## Adopt

1. **The repo map algorithm**: tags → reference graph → personalized PageRank → token-budget
   binary search → signature rendering. Kai reimplements it in TypeScript on `web-tree-sitter`
   and persists tags in its SQLite index ([spec](../../specs/repo-index.md)).
2. **tree-sitter `ERROR`/`MISSING` node detection as a universal parse gate**
   ([Hallucination Firewall](../../specs/hallucination-firewall.md)).
3. **"Did you mean" failure messages** listing the closest real lines when an edit anchor fails
   to match.
4. **Showing errors in structural context** (enclosing function/class) instead of bare line
   numbers.
5. **A bounded reflection budget.** Kai generalizes it into failure fingerprints and replan
   ([spec](../../specs/repair-replan-controller.md)).

## Reject or adapt

- **Fuzzy auto-apply** (`SequenceMatcher` ≥ 0.8) can silently put an edit in the wrong place.
  Kai accepts only exact or whitespace-normalized matches and returns candidates on failure.
- **Text-parsed edit formats.** Gemini's native function calling with typed arguments is more
  reliable to parse and keeps Kai in-distribution with Gemini CLI's tools.
- **Lint after write.** Kai validates *before* the change reaches the worktree, the way
  SWE-agent does ([swe-agent.md](swe-agent.md)).
- **Auto-commit per edit.** Kai uses hidden checkpoint refs and leaves the user's branch history
  alone.
- **User-curated "files in chat"** as the main relevance signal. Kai derives relevance from the
  task, failing tests, diagnostics and the ledger.
