# ADR-0015: User-owned task contract

- Status: Proposed
- Date: 2026-10-05
- Origin: design review 1, finding 1 ("the model has too much influence over its own requirements"), and the authorization part of finding 7
- Related: [specs/task-contract.md](../specs/task-contract.md), [specs/test-integrity-guard.md](../specs/test-integrity-guard.md), [specs/tool-surface.md](../specs/tool-surface.md), [ADR-0009](0009-verification-architecture.md), [ADR-0016](0016-robustness-amendments.md)

## Context / problem

The original design let the model set `objective` and `acceptance_criteria` through
`update_plan`, and kept no separate immutable copy of the user's requirements. The Test
Integrity Guard also accepted a test-change justification if the change aligned with "a
deliberate behaviour change named in the transaction `instruction`s". Those instructions are
written by the model. Together, these let Gemini rewrite the exam paper before grading itself: it
could restate the requirement, change the code, change the test to match, and justify the test
change with its own words.

## Considered alternatives

1. **Keep model-editable requirements, but log every change.** Auditable after the fact, but it
   does not stop self-authorization during a headless run.
2. **Freeze the requirements, with an LLM-extracted acceptance list.** The model would still be
   the author of the "requirements", just at a different time.
3. **A user-owned, append-only Task Contract.** The user's text is stored verbatim. Only
   user-action protocol handlers can amend it. Model-authored plans are a separate,
   non-authoritative layer. Authorization to relax evidence must come from a verifiable quote of
   user text, or from the user.

## Decision

**Option 3.**

- `task.submit` records a **Task Contract**: the prompt and any explicit acceptance items,
  **verbatim**, plus the task-start hashes of repository instruction files. User steering
  messages, `task.amend` and user approvals in permission requests append entries. Nothing is
  overwritten, and **no model-reachable code path can append or change an entry**. This is
  enforced with a `UserActionToken` that only KSP user-action handlers can mint.
- `update_plan` has **no** `objective` or `acceptance_criteria` fields. The model can record
  `interpretations` and additive `proposed_criteria`. These are rendered under a separate
  "model-authored" heading and are never authoritative.
- **Authorization to weaken evidence** (tests, assertions, verification config) comes only from:
  - a **contract citation**: a verbatim quote of a user-owned entry, checked deterministically
    for existence and relatedness; or
  - an **explicit user approval**.
  The model's transaction `instruction`s, plans, notes, claims and justification `reason` text
  never authorize anything. High-severity changes additionally need a mandatory integrity review
  ([ADR-0016](0016-robustness-amendments.md)).
- The epoch brief, replan brief, critic input and verification report all use the contract, not
  model restatements.

## Rationale

Correctness gates are only as strong as the requirements they check against. Separating
*who may say what the task is* from *who does the task* removes the main self-grading loophole.
The deterministic citation check keeps authorization cheap and explainable: no LLM decides
whether the model may weaken its own tests.

## Consequences

- Legitimate test updates still work. When the user asked for the behaviour change, the model
  quotes that request. When the user didn't, the user is asked (interactive), or the task ends
  `blocked` with `integrity_review_required` (headless). That is honest, but headless runs on
  underspecified prompts will block more often. The benchmark measures how often.
- Prompts become slightly more important to write well. Explicit `acceptance` items give the
  strongest citations.
- The relatedness check is heuristic. It can only make the system *stricter* than ideal (false
  `unrelated`). It cannot let model text become authority.

## Unresolved questions

1. Should the user be able to delegate authority ("you may update snapshots in this task") as a
   structured permission rather than free text? Proposed: yes, as a typed `acceptance` entry in a
   later iteration.
2. Should repository-level policies (e.g. "tests under `legacy/` may be deleted") be citable from
   `.kai/project.json`? Probably yes, since it is user-owned and already integrity-protected.
