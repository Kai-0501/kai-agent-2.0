# Spec: Reasoning Governor (and Risk Assessor)

- Package: `packages/core` (`governor/`, `risk/`)
- Research: [gemini-api.md §6](../research/gemini-api.md#6-thinking-reasoning-effort) (Gemini CLI and OpenCode hard-code HIGH)

## Responsibility

Choose the **reasoning effort for every model request** from task risk, current phase and
*observed* difficulty, so that trivial operations do not pay for deep thinking and hard problems
get it when the evidence shows they need it. Record every decision with its reason.

The **Risk Assessor** (a small sibling module) computes the task risk used here, and also by the
Verification Engine (T4 policy) and the Critic (triggers).

**Not responsible for:** model routing between models in v1. A `model` override per phase is
supported in config but not used by default.

## Interfaces

```ts
type ReasoningEffort = "minimal" | "low" | "medium" | "high";

interface GovernorInput {
  purpose: RequestPurpose;         // what this request is for
  phase: Phase;                    // from update_plan / controller
  risk: RiskAssessment;
  lastTurn?: LastTurnSummary;      // what happened in the previous turn
  repair?: { failureFp: string; attemptsOnFp: number; totalAttempts: number; stuck: boolean };
  epochTurnIndex: number;          // 0 = seed request
}
type RequestPurpose = "work" | "replan" | "critic" | "decision_digest" | "probe";
type Phase = "explore" | "plan" | "implement" | "repair" | "verify";

interface LastTurnSummary {
  toolKinds: ("read" | "search" | "edit" | "shell" | "test" | "plan" | "complete")[];
  editRejected?: "match" | "firewall" | "stale";
  sameRejectionCount?: number;     // consecutive identical rejections
  verificationFailed?: boolean;
  progress: boolean;               // new evidence: an edit applied, a check passed, or a new file region read
}

interface GovernorDecision { effort: ReasoningEffort; rule: string; inputsDigest: string }

interface ReasoningGovernor { decide(input: GovernorInput): GovernorDecision }

interface RiskAssessment {
  level: "low" | "medium" | "high";
  score: number;                    // 0..100
  reasons: string[];                // e.g. "touches src/auth/**", "adds dependency", "changes exported API"
}
interface RiskAssessor {
  initial(task: { contract: TaskContract; mentionedPaths: string[] }): RiskAssessment;   // user-owned text only
  update(current: RiskAssessment, diff: DiffSummary, history: { replans: number; attempts: number }): RiskAssessment;
}
```

## Default policy

Rules are evaluated top to bottom, and the first match wins. The result is then clamped to the
**risk floor**, and finally to the model's supported levels (provider).

| # | Condition | Effort | Rationale |
|---|---|---|---|
| R1 | `purpose = decision_digest` or `probe` | `low` (`minimal` for probes) | Summarization and bookkeeping |
| R2 | `purpose = replan` | `high` | Fresh approach after being stuck |
| R3 | `purpose = critic` | `high` if risk is high, else `medium` | Review quality matters, and it is selective |
| R4 | `repair.stuck = true` or `attemptsOnFp ≥ 2` | `high` | Observed difficulty |
| R5 | `lastTurn.verificationFailed` (first time on this fp) | `medium` | A real bug signal |
| R6 | `lastTurn.editRejected` with `sameRejectionCount ≥ 2` | `medium` | The model is misreading the code |
| R7 | `lastTurn.editRejected` (first time) | `low` | Usually a mechanical fix (anchor, typo, missing import) |
| R8 | `epochTurnIndex = 0` and `phase ∈ {explore, plan}` | `medium` (`high` if risk is high) | Initial understanding and planning |
| R9 | `phase = implement` and the last turn made progress | `low` (`medium` if risk is at least medium) | Executing a plan |
| R10 | Last turn was only `read`/`search` and made progress | `low` | Navigation |
| R11 | `phase = verify` (only running checks, reading results) | `low` | Mechanical |
| R12 | Default | `medium` | |

**Risk floor:** low risk → `minimal` (no floor); medium → `low`; high → `medium`.

**De-escalation:** after a turn that applied a transaction with no introduced diagnostics, or
passed a verification tier, the next `work` request goes **down one level** from the rule's
result. It never goes below the risk floor, and never below `low` unless the task is trivial
(see below). This prevents sticking at `high` after a single hard step.

**`minimal`** is used only for R1 probes and for tasks the Risk Assessor classifies as
**trivial**: risk score under 10, a single file in scope, and an objective matching mechanical
patterns such as rename, typo, comment or format. Gemini's own docs describe `minimal` as
"roughly equivalent to off", so it is reserved for cases where reasoning has nothing to add.

## Risk Assessor defaults

Score contributions (capped at 100). `level`: under 25 low, 25–59 medium, 60 and above high.

| Signal | Points |
|---|---|
| Path matches `**/auth/**`, `**/security/**`, `**/crypto/**`, `**/permissions/**`, `**/payment*/**` | +30 |
| Migrations (`**/migrations/**`, `*.sql`, ORM migration files) | +30 |
| Concurrency primitives in touched code (`Mutex`, `Lock`, `threading`, `asyncio.Lock`, `Atomics`, `worker_threads`, `go func`, `chan`, `sync.`) | +25 |
| Contract keywords (user-owned text): security, auth, race, deadlock, concurrency, migration, encrypt, token, password, breaking, public API | +15 each (max +30) |
| New dependency added to a manifest | +20 |
| Exported/public symbol signature changed (index diff) | +15 |
| Files changed > 5 | +10; > 15: +20 |
| Changed lines > 300 | +10; > 1000: +20 |
| CI, build or infra config touched | +15 |
| Replans ≥ 1 | +15 |
| Repair attempts ≥ 4 | +10 |

`initial` uses the task contract's text (user-owned; never the model's plan) and paths only. `update` is re-run after each applied transaction.

## Events and telemetry

`ReasoningDecision {turnId, effort, rule, inputsDigest}` for every request.

Telemetry per (rule, effort): count, mean thought tokens, mean output tokens, and outcome of the
following turn (progress, rejection, verification failure). This lets the policy be tuned from
data: if R10 turns at `low` show high subsequent rejection rates, raise it.

## Ablations

- `--governor=fixed:high` (the Gemini CLI and OpenCode baseline), `fixed:medium`, `fixed:low`.
- The success metric is **thought tokens per resolved task** at non-inferior resolve rate
  ([ADR-0014](../adr/0014-measurement-gated-mechanisms.md)).

## Acceptance tests

1. A table-driven test over every rule. Each case gives the expected effort and rule ID.
2. A clamping test: an unsupported `minimal` maps to `low`.
3. A risk test over fixture diffs (auth change, migration, dependency add) gives the expected
   levels.
4. De-escalation: a scripted turn sequence (fail, fail, success) gives medium → high → medium.
