# Spec: Repair / Replan Controller

- Package: `packages/core` (`repair/`)
- Research: [Gemini CLI loop detection](../research/upstream/gemini-cli.md), [Goose tool monitor](../research/upstream/goose.md), [Aider reflection limit](../research/upstream/aider.md), [synthesis §2.7](../research/synthesis.md#27-loop-detection-should-use-verification-evidence-not-conversation-similarity)

## Responsibility

Detect unproductive repair loops early and deterministically, enforce budgets, and run
**clean replans** in a fresh context with only the information that matters. Stop with an
honest `blocked` state when repair is not converging.

**Not responsible for:** fixing code itself, or choosing thinking levels (it supplies signals
the Governor uses).

## Fingerprints

```ts
interface FailureFingerprint {
  fp: string;                 // stable hash
  kind: "diagnostic" | "test" | "firewall" | "edit_match" | "command" | "integrity" | "critic";
  components: string[];       // normalized parts (below)
  exact: string;              // one representative verbatim message (for briefs)
}
interface ApproachFingerprint {
  fp: string;
  touched: string[];          // sorted "path#symbol" entries changed by the attempt
  shingles: Set<string>;      // 5-gram token shingles of the added lines (normalized identifiers kept)
}
```

**Failure normalization** (per kind):
- Diagnostic: `class or code | path | symbol`. Line and column, numbers, temp paths, hex
  addresses and quoted literals longer than 20 chars are removed.
- Test: `test_id | assertion matcher | normalized message` (numbers replaced by `<n>`, values
  longer than 40 chars hashed) | the top in-workspace stack frame `path#function`.
- Firewall or edit-match: `check | path | missing symbol or anchor hash`.
- Command: `argv[0..1] | exit code | first error line normalized`.

A **failure set** (all introduced failures after a check) has a set fingerprint as well as
per-failure fingerprints.

**Attempt** = the transactions between two consecutive verification outcomes (or two firewall
rejections) on the same failure set.

## Detection rules

| Rule | Condition | Action |
|---|---|---|
| D1 identical call | Same tool + same args (canonical JSON) 3 times in a row, with the same result | Return a `kai_notice`: *"Identical call repeated; result unchanged."* At 5 → stuck |
| D2 no-op edit | `replace` with `old_string == new_string`, or an edit whose net diff is empty over 2 attempts | Notice. At 3 → stuck |
| D3 same failure after similar fix | The same failure fp persists after an attempt whose approach fp has Jaccard similarity ≥ 0.7 with any previous attempt on that fp | Escalate the Governor (R4). At the 2nd occurrence → stuck |
| D4 oscillation | Failure set A → B → A (set fps) across 3 attempts, or a file region flips back to a previous content hash | stuck |
| D5 non-convergence | Introduced failure count not decreasing over 3 consecutive attempts | Escalate. At 4 → stuck |
| D6 budget | `attemptsOnFp ≥ 3`, or `totalRepairAttempts ≥ 8` (task), or repair tokens over 40% of the task token budget | stuck |
| D7 degenerate output | Provider `degenerate_output` error twice in an epoch | New epoch + escalate. A 3rd time → stuck |
| D8 edit rejection loop | 3 consecutive firewall or match rejections on the same file with the same finding fps | Notice with the real code excerpt. At 4 → stuck |

`stuck` triggers a **replan** if the replan budget remains (default 2 per task). Otherwise the
task goes to `blocked`, with a report.

## Replan

1. **Optionally revert.** If the current diff makes things worse than the task-start checkpoint
   (more introduced failures than at the first gate), restore the last checkpoint where the
   failure count was lowest. Default: keep the diff, but describe it.
2. **Start a new epoch** with reason `replan` and `purpose: "replan"`, so the Governor picks
   `high`.
3. **Replan brief** (deterministic, from projections). It replaces the normal brief's
   narrative sections:
   ```
   <task_contract version="N"> user-owned requirements, verbatim (from the Task Contract) </task_contract>
   <replan>
   Current state: diff stat + per-file intents; checkpoint reverted? yes/no
   Approaches already tried (do NOT repeat):
     1. <attempt summary from transaction instructions + touched symbols> → result: <exact failure>
     2. …
   Remaining failures (exact):
     - <fp exact text, location, artifact id>
   Required verification: <gate checks that must pass>
   Constraints learned: <notes/decisions>
   Instruction: Diagnose the root cause before editing. Propose a different approach, record it
   with update_plan(plan, decisions), then implement.
   </replan>
   ```
4. The replan epoch's first request uses `allowed_tools` with **read-only and plan tools only**
   (no edits). This forces a diagnosis-first turn. Restrictions are lifted once `update_plan` is
   called with a new plan.
5. No previous model text or reasoning is carried over, only the evidence. This avoids
   anchoring on the failed hypothesis. The objective and acceptance criteria come **only** from
   the [Task Contract](task-contract.md). The model's earlier plans, interpretations and
   proposed criteria are not copied as requirements, and the replan cannot narrow them.

## Budgets (defaults)

| Budget | Default |
|---|---|
| `repair.maxAttemptsPerFailure` | 3 |
| `repair.maxAttemptsPerTask` | 8 |
| `repair.maxReplans` | 2 |
| `repair.maxRepairTokenShare` | 0.4 of `task.tokenBudget` (if set) |
| `task.tokenBudget` | unset (interactive); set per benchmark task |

The budget state is shown to the model as a `budget` notice when 2 or fewer attempts remain
(Goose's turn-budget idea).

## Events and telemetry

Events: `FailureFingerprinted`, `RepairAttemptRecorded`, `StuckDetected {rule}`,
`ReplanStarted`.

Telemetry: attempts per task, stuck detections by rule, replans, replan success rate (verified
within the replan epoch), tokens spent in repair vs total, and time-to-green.

## Acceptance tests

1. A scripted fake model that applies the same failing fix 3 times → D3 stuck after the 2nd
   repeat → replan epoch with a read-only first request → the brief lists both attempts.
2. Oscillation between two failure sets → D4.
3. A legitimately converging sequence (5 → 3 → 1 → 0 failures) → no stuck detection.
4. Budget exhausted after 2 replans → `blocked`, with a report containing the remaining
   failures.
