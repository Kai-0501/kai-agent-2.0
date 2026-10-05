# ADR-0023: Correctness corrections from the design audit

- Status: Proposed
- Date: 2026-10-05
- Related: [ADR-0005](0005-context-compiler-and-epochs.md), [ADR-0007](0007-editing-protocol.md), [ADR-0009](0009-verification-architecture.md), [ADR-0012](0012-tool-surface-and-dynamic-exposure.md), [ADR-0013](0013-workspace-safety-and-checkpoints.md), specs [context-compiler](../specs/context-compiler.md), [patch-engine](../specs/patch-engine.md), [verification-engine](../specs/verification-engine.md), [critic](../specs/critic.md), [test-integrity-guard](../specs/test-integrity-guard.md), [tool-surface](../specs/tool-surface.md)
- Supersedes (partially): ADR-0012's model-writable `objective`/`acceptance_criteria` in
  `update_plan`; ADR-0009's rerun-only flaky classification; ADR-0007/ADR-0013's in-process-only
  commit rollback

## Context / problem

A review of the founding specs found seven gaps. They were tolerable for one provider with
large context windows; with stateless replay, small local models and automatic learning they
become real defects.

| # | Gap in the founding specs | Failure it allows |
|---|---|---|
| 1 | `update_plan` let the model set `objective` and `acceptance_criteria` | A model narrows the task to what it already did; integrity justifications then cite the narrowed criteria |
| 2 | A failure that passes on rerun was classified `flaky` | A newly introduced race passes the gate as "flaky" |
| 3 | Multi-file commit used per-file rename plus in-process rollback | A crash between renames leaves a half-applied transaction with no durable record of intent |
| 4 | Only the seed was budgeted; the next request's full size was not checked | Batched tool results or replayed history overflow a small context window mid-epoch |
| 5 | The manifest counted harness-added content only | Assistant text, call arguments and native replay items were invisible to accounting, so small-window budgets were wrong |
| 6 | Nested instruction files were loaded when a *tool result* first touched a path | An edit could land in a subtree before its rules were seen |
| 7 | Critic budget exhaustion let the task be `verified` on deterministic evidence | An unresolved high-severity integrity escalation could be silently waived |

## Decision

1. **User-owned objectives are authoritative.** `TaskCreated.objective` and `acceptance` are
   user-owned and immutable except through the user's `task.amend` (event `TaskAmended`).
   `update_plan` loses `objective` and `acceptance_criteria`; it gains `derived_criteria`
   (additive, labelled model-authored, can only add checks) and `clarification` (a question
   for the user). Learned skills, model plans and critic output cannot narrow user criteria or
   authorize weaker checks.
2. **No accepted flakiness without baseline evidence.** A failure that passes on rerun is
   `flaky` only if the profile's user-owned `knownFlaky` list names it, or the same check is
   intermittent **at baseline** (fails at least once in `verify.baselineFlakyRuns`, default 3,
   runs). Otherwise it is `introduced_intermittent`, which blocks. If the baseline cannot run,
   it blocks (fail closed).
3. **Durable prepared transactions.** Before the first rename, the Patch Engine writes the
   before and after blobs and a **prepared manifest** (paths, before/after hashes, temp paths)
   and commits a `TransactionPrepared` event. Restart recovery compares disk hashes with the
   manifest and either completes the transaction, rolls it back, or blocks with a conflict
   report. Temp files are cleaned up from the manifest.
4. **Request preflight.** Before every model request, the Context Compiler estimates the
   *complete* pending request (instructions, declarations, seed, replayed history including
   native items, batched tool results, notices) with the conservative estimator for the
   route, and keeps it under the effective input limit minus output reserve and a safety
   margin. Over the limit, it shapes harder, elides in a batch, or starts an epoch, in that
   order; it never sends an over-limit request.
5. **Complete manifests.** Manifest categories include `assistant_text`,
   `function_call_args`, `replay_native`, `learned_procedures` and `tail_web`. Reported and
   estimated values stay separate, and unknown reported usage stays unknown.
6. **Instructions before the first affected mutation.** Before applying a transaction or a
   mutating command whose targets lie under a directory with unseen applicable instruction files
   (`AGENTS.md`, `KAI.md`, `GEMINI.md`), Kai withholds the mutation, delivers the instructions
   as a notice, and asks the model to reconsider and resend. JIT loading on reads remains.
7. **Mandatory review obligations survive budgets.** A high-severity or `needs_review` integrity
   escalation creates a **review obligation**. Only a validated critic review or the user's
   explicit approval discharges it. Exhausting the *optional* critic budget never discharges
   it; the task then ends `implemented_unverified` with the open obligation and a pending user
   approval, not `verified`.

## Rationale

Each correction closes a path by which a model claim, a timing accident or a budget limit could
turn into a `verified` verdict or a corrupted worktree, which the founding invariants forbid.

## Consequences

- New events: `TaskAmended`, `TransactionPrepared`, `TransactionRecovered`,
  `RequestPreflighted`, `InstructionsWithheldMutation`, `ReviewObligationOpened`,
  `ReviewObligationResolved`.
- The verification state machine and critic spec gain obligation handling; the patch engine
  gains a recovery procedure and a fault-injection test per crash point.
- Small-context profiles depend on items 4 and 5 for correct budgets.

## Unresolved questions

1. The cost of baseline reruns for intermittent classification on slow suites. Measured in the
   benchmark; `baselineFlakyRuns` is configurable but never below 1.
