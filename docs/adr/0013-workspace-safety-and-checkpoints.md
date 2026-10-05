# ADR-0013: Workspace safety and checkpoints

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/patch-engine.md](../specs/patch-engine.md), [failure-modes.md](../failure-modes.md), [research/upstream/cline.md](../research/upstream/cline.md), [research/upstream/t3code.md](../research/upstream/t3code.md), [research/upstream/codex-and-serena.md](../research/upstream/codex-and-serena.md)
- Partially superseded by: [ADR-0023](0023-audit-corrections.md) (crash recovery of multi-file transactions uses the durable prepared manifest)

## Context / problem

Kai edits a user's working tree and runs shell commands. It must be able to undo its work
exactly, must not corrupt git state or clobber concurrent user edits, must not run destructive or
exfiltrating commands without consent, and must survive interruption.

## Considered alternatives

Checkpoints:
1. **Auto-commit per edit** (Aider). Pollutes branch history and interferes with the user's own
   commits.
2. **`git stash`.** Changes the user's working tree and stash list. Fragile.
3. **A shadow git directory** (OpenCode). Isolated, but duplicates object storage.
4. **Hidden refs in the user's repository, with a private index** (T3 Code refs plus Cline's
   private `GIT_INDEX_FILE`). Shares object storage, includes untracked files, never touches
   `HEAD`, the branch, the user's index or the stash.

Isolation:
1. Work directly in the user's tree (default for interactive use).
2. A `git worktree` per task (T3 Code / Cursor style). Full isolation, but the user must merge
   the results.
3. A container or OS sandbox (Codex bwrap/Seatbelt, OpenHands Docker). Strongest isolation, and
   the heaviest.

## Decision

- **Workspace checkpoints** use git plumbing with `GIT_INDEX_FILE=<kai-data>/index/<session>`:
  `git add -A` (honouring `.gitignore`) into the private index, then `write-tree`, then
  `commit-tree`, then `update-ref refs/kai/checkpoints/<session>/<n>`. Taken at **task start**,
  **before each transaction batch**, and **before running commands classified as mutating**.
  Restore uses `read-tree` into the private index, then `checkout-index` for the affected paths,
  after confirming the current files match Kai's last known state (to avoid clobbering user
  edits). Non-git workspaces fall back to blob copies of touched files.
- **Default isolation:** the user's working tree. **Opt-in** `--worktree`: a per-task
  `git worktree add` on a `kai/<task>` branch.
- **Concurrent edits.** Before every transaction, and before any restore, file hashes are
  compared with the ledger's and Kai's last-written hashes. A mismatch means the user (or another
  process) changed the file. Kai then refuses to overwrite, and emits `ExternalChangeDetected`
  with the changed paths.
- **Command policy** (Codex execpolicy idea, OpenCode rule format): ordered rules
  `{match, action: allow|ask|deny}`, matched on the parsed argv (via a shell parser, never a
  regex on the raw string), with built-in **deny-by-default classes**: privilege escalation
  (`sudo`), destructive filesystem operations outside the workspace, `git push`/`reset
  --hard`/`clean -fdx`/branch deletion, pipes from network to shell (`curl … | sh`), package
  publish, and credential file access. Build, test, lint and format commands from the
  verification profile are pre-allowed.
- **Environment sanitization** (Gemini CLI): commands run with an environment that strips known
  secret variables (`*_API_KEY`, `*_TOKEN`, cloud credentials, the Gemini key) unless a variable
  is explicitly allowlisted.
- **Process control:** every command runs in its own process group with a timeout (default 120 s,
  verification profile overrides), output capped live to the Artifact Store, and group kill on
  timeout or cancel. Background processes (`background: true`) are registered, logged to
  artifacts and killed at session end.
- **OS sandboxing is postponed.** The process runner has a `wrap(argv)` hook so `bwrap` (Linux)
  or `sandbox-exec` (macOS) can be added without touching callers.

## Rationale

Hidden refs with a private index give exact, cheap, untracked-inclusive snapshots without any
user-visible git side effects. Hash checks before writing turn "clobbered user edits" into an
explicit, recoverable event. A rule-based policy over parsed argv is predictable and auditable.
Full sandboxing is valuable but large, and not required to test Kai's core thesis.

## Consequences

- `refs/kai/*` accumulates objects, so `kai gc` deletes refs older than the retention policy, and
  then git's normal GC collects the objects.
- Some commands cannot be classified reliably (e.g. scripts). `ask` is the default for unknown
  mutating commands in interactive mode. Headless runs need an explicit policy file.
- Restoring after a crash: on startup, the runtime finds the last `TransactionApplied` without a
  matching verification or `TransactionRolledBack` event and offers to keep or roll back.

## Unresolved questions

1. Should `--worktree` be the default for headless or benchmark runs? Proposed: yes for the
   benchmark, no for interactive use.
2. Windows support for process groups and the shell parser (postponed with Windows in general).
