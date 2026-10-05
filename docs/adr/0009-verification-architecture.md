# ADR-0009: Verification architecture

- Status: Proposed. Amended by [ADR-0015](0015-user-owned-task-contract.md) and [ADR-0016](0016-robustness-amendments.md).
- Date: 2026-10-05
- Related: [specs/verification-engine.md](../specs/verification-engine.md), [specs/test-integrity-guard.md](../specs/test-integrity-guard.md), [specs/critic.md](../specs/critic.md), [specs/repair-replan-controller.md](../specs/repair-replan-controller.md)

## Context / problem

The model's statement that work is complete must never be enough to mark a task complete. Every
studied harness ends a task when the model says so (`attempt_completion`, `finish`, or no more
tool calls). Some lint or test along the way (Aider's reflection loop, OpenCode's post-edit
diagnostics), but none has an explicit, evidence-based completion state.

## Considered alternatives

1. **Model-declared completion plus optional tests** (status quo). Rejected.
2. **Always run the full test suite at the end.** Simple, but slow, often noisy (pre-existing
   failures, flaky tests), and it misses typecheck and lint regressions.
3. **A tiered verification engine with a task state machine, project verification profiles,
   baseline-aware failure classification and an explicit completion gate.**

## Decision

**Option 3.**

**Task states.** `open → in_progress → implemented_unverified → verifying → (verified |
verification_failed) → …`, plus `blocked` and `cancelled`. Only the Verification Engine can move
a task to `verified`. A model `complete_task` call moves it to `implemented_unverified` and
starts the **completion gate**. The task's final reported state is one of **`verified`**,
**`verification_failed`** or **`implemented_unverified`** (when verification could not run:
no profile, or the user disabled it). Each comes with an evidence bundle.

**Tiers** (each a set of `Check`s with expected cost):

| Tier | When | Examples |
|---|---|---|
| T0 Apply | Every transaction, synchronous (firewall) | Parse, placeholders, anchors and versions, scope |
| T1 File | Every transaction (firewall, LSP overlay) | Diagnostics delta on edited files and top dependents |
| T2 Affected | End of each model turn that changed files (async, bounded); at the gate | Incremental typecheck of affected projects, lint on changed files, format check |
| T3 Targeted tests | When the model runs tests; at the gate | Tests related to changed files (runner-native "related" mode, import graph, naming) |
| T4 Broad | At the gate when risk ≥ medium or configured | Full test suite or the configured regression command |

**Verification profile.** It is discovered from `package.json` scripts, `tsconfig`,
`pyproject.toml`, `Makefile`, `justfile` and CI workflow files, shown to the user once,
and persisted in `.kai/project.json` (committable). It holds commands, timeouts, and how to run
related tests.

**Lazy baselines.** When a check fails at the gate, re-run that check on the **task-start
workspace checkpoint**, in a temporary git worktree, to classify each failure as
**introduced**, **pre-existing** or **flaky** (failing intermittently on reruns). Only
*introduced* failures block `verified`. Pre-existing failures are reported.
*Amended by [ADR-0016](0016-robustness-amendments.md) (R2):* passing on rerun **no longer**
makes a failure non-blocking. Non-blocking flakiness must be **established at baseline**
(baseline reruns or baseline-only flake history) or be a **user-approved exception**
(`knownFlaky`, or a per-task approval). A failure that appears now while the baseline passed
every run is `introduced_intermittent` and blocks. *(R7 and
[ADR-0015](0015-user-owned-task-contract.md)):* test-change authorization comes only from the
user-owned Task Contract or the user. Mandatory integrity review has a reserved budget and,
if unresolved, blocks `verified`. The optional risk review may be skipped.

**The gate pipeline:** T2 → T3 → (T4 if required) → baseline classification → diff hygiene (no
debug leftovers, no stray files, no conflict markers) → **Test Integrity Guard** review of the
whole task diff → unfulfilled promissory symbols → **Critic** if risk triggers fire → final
state. The [verification spec](../specs/verification-engine.md#completion-gate) gives the
authoritative step list. Failures go back to the worker as structured repair items through the
Repair/Replan Controller, within budget.

## Rationale

Tiering keeps feedback early and cheap (T0/T1 per transaction) and saves expensive checks
(T3/T4) for when they are informative. Baselines prevent the two classic failures: blaming the
agent for pre-existing breakage, and the agent "fixing" unrelated tests to get to green. An
explicit state machine makes "done" an auditable fact, not a sentence.

## Consequences

- Projects without runnable checks end at most `implemented_unverified`. That is honest, but
  users will see it often in unconfigured repositories. `kai init` profile discovery matters.
- Baseline worktrees cost disk and time, and are only created on failure. Large repositories may
  need `git worktree add --no-checkout` plus a sparse checkout of affected paths.
- The verification evidence bundle (commands, exit codes, artifact IDs, parsed results) is part
  of the final report and the event log.

## Unresolved questions

1. Default T4 policy: always, or risk-based? Proposed: risk-based, with the profile able to force
   it.
2. Flaky-test detection: how many reruns? Proposed: 2 reruns for failing targeted tests only.
3. Should T2 run after every turn in the background? It costs CPU but gives earlier feedback.
   Make it configurable and measure.
