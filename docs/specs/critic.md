# Spec: Selective Independent Critic

- Package: `packages/core` (`critic/`)
- Decisions: [ADR-0009](../adr/0009-verification-architecture.md), amended by [ADR-0016](../adr/0016-robustness-amendments.md)
- Research: [OpenHands critics](../research/upstream/openhands.md), [synthesis §2.6](../research/synthesis.md#26-the-critic-is-the-most-expensive-mechanism-so-it-is-the-most-selective)

## Responsibility

Run fresh-context reviews that look for defects deterministic checks cannot see, and return
**evidence-cited findings**. The critic has two modes with **different obligations**:

| Mode | Purpose | Optional? | If it cannot run or the budget is exhausted |
|---|---|---|---|
| **`risk_review`** | Logic, security, concurrency, error-handling, API-contract and requirements defects in risky changes | **Yes**: risk-triggered, skippable | Skipped. The task may still be `verified` on deterministic evidence. The report lists the unreviewed risk triggers |
| **`integrity_review`** | Confirm that a **contract-backed**, high-severity test or verification change is consistent with the cited user requirement ([test-integrity-guard](test-integrity-guard.md#justification-and-review)) | **No**: required by the Guard when such a finding exists | The finding stays **unresolved**, which **blocks `verified`** until the user approves (interactive) or the task ends `blocked` (headless) |

**Not responsible for:** style nits, re-running checks, or rewriting code. It reports; the
worker fixes. The critic **never authorizes** relaxing a test or requirement. In
`integrity_review` it can only confirm or reject consistency with user-owned contract text that
the Guard has already verified as cited ([task-contract](task-contract.md)).

## Triggers

**`risk_review`** runs at gate step 9 only if **at least one** trigger fires (configurable), and
`critic.mode != "off"`:

| Trigger | Source |
|---|---|
| Risk level `high` | Risk Assessor |
| Paths: auth, security, crypto, permissions, payments | Risk Assessor |
| Concurrency primitives touched | Risk Assessor |
| DB migrations | Risk Assessor |
| Exported / public API signature changed | Index diff |
| New dependency | Firewall F5 |
| Diff > 400 changed lines or > 8 files | Diff stat |
| Repair attempts ≥ 4, or any replan | Repair Controller |
| User request (`--critic=always`) | Config |

**`integrity_review`** runs at gate step 7, once per batch of contract-backed high-severity
integrity findings. It runs **regardless of `critic.mode`** when its own switch,
`critic.integrityReview`, is on (the default). If that switch is off, every such finding needs
user approval instead. It is never silently skipped.

`critic.mode` (risk review only): `auto` (default), `always`, or `off`.

## Inputs (no worker history in either mode)

```ts
interface RiskReviewInput {
  contract: TaskContract;             // user-owned requirements, verbatim (not model restatements)
  diff: string;                       // unified, task-start checkpoint → now; truncated per file if huge (with artifact ref)
  changedSymbols: SymbolCard[];       // before/after signatures for changed exported symbols
  context: { path: string; excerpt: string }[];  // callers of changed public symbols (≤ 10), selected by index
  verification: EvidenceBundle;       // what passed, what was pre-existing
  integrity: IntegrityFinding[];      // with their resolution status
  triggers: string[];                 // why the critic is running
}

interface IntegrityReviewInput {
  findings: IntegrityFinding[];       // contract-backed, high-severity
  testDiff: string;                   // only the test / verification-config hunks involved
  citedEntries: ContractEntry[];      // the verbatim contract entries cited (+ task-start instruction files if cited)
  changedProductionSymbols: { card: SymbolCard; diff: string }[];
}
```

Size targets: `risk_review` ≤ 20k tokens; diffs over budget are reviewed **per file group**
with up to 3 calls, each with the shared header. `integrity_review` ≤ 6k tokens per batch.

## Execution

- A fresh interaction (new chain, or stateless), `purpose: "critic"`. The Governor picks `high`
  for `integrity_review` and for high-risk `risk_review`, otherwise `medium`.
- **Tools:** read-only (`read_file`, `read_symbol`, `grep_search`, `read_artifact`, plus
  `code_intel` if active), enforced with `allowed_tools`. At most 8 tool turns for
  `risk_review` and 3 for `integrity_review`.
- **Output** goes through a function declared only for the critic: `submit_review(findings[])`
  in `risk_review`, and `submit_integrity_verdicts(verdicts[])` in `integrity_review`. It is
  not done through `response_format`, because combining structured output with function calling
  in one interaction has not been verified for Interactions.

```ts
interface CriticFinding {                        // risk_review
  severity: "blocking" | "major" | "minor";
  category: "logic" | "security" | "concurrency" | "error_handling" | "api_contract" | "tests" | "requirements";
  path: string; line?: number;
  claim: string;                 // what is wrong
  evidence: string;              // quoted code (must match the file) and reasoning
  contractEntryId?: string;      // required for category "requirements": which user requirement is violated
  suggestedCheck?: string;       // a concrete test or command that would demonstrate it
}

interface IntegrityVerdict {                     // integrity_review
  findingId: string;
  verdict: "consistent" | "inconsistent";
  contractQuote: string;         // must occur verbatim in a cited entry
  codeQuote: string;             // must occur in the test diff or changed production code
  reasoning: string;
}
```

- **Evidence validation (deterministic).**
  - `risk_review`: every `blocking` finding's `path:line` must exist, and its quoted code must
    occur in the current file (whitespace-normalized). `requirements` findings must name a real
    contract entry. Findings that fail are **downgraded to `minor`** and marked
    `unverified_claim`.
  - `integrity_review`: a `consistent` verdict counts only if both quotes validate. A verdict
    that fails validation counts as **unavailable** (unresolved, so the user decides). It is
    never treated as consistent.
- Blocking `risk_review` findings → `verification_failed`. They are delivered to the worker as
  repair items (counted against the repair budget), with the critic's `suggestedCheck`
  included. Major and minor findings go into the final report.
- `inconsistent` integrity verdicts → the finding stays unresolved, and the worker is told the
  change is not backed by the requirement (a repair item: restore the test or get user
  approval).
- After the worker addresses blocking findings and the gate passes again, `risk_review`
  **re-runs only on the files that changed since its last review** (incremental), at most twice
  per task.

## Modes and budgets

| Budget | Default | Applies to | On exhaustion |
|---|---|---|---|
| `critic.maxRiskReviewTokens` | 60k per task (input + output) | `risk_review` only | Stop the risk review. The report says *"risk review budget exhausted"* and lists the unreviewed triggers. The task **may still be `verified`**, unless a mandatory review is pending (below) |
| `critic.integrityReviewTokens` | 20k per task, **reserved** | `integrity_review` only | Remaining findings are **unresolved**, which blocks `verified` until the user approves (interactive) or the task ends `blocked` with `integrity_review_required` (headless) |

The two budgets are separate pools. **Risk review can never consume the integrity reserve**, so
running out of optional review never removes a mandatory one. Provider errors and validation
failures follow the same rule: optional review degrades to "skipped and reported", and mandatory
review degrades to "unresolved, so the user decides". `critic.mode=off` skips only the risk
review. `critic.integrityReview=false` makes every mandatory review unresolved, so the user
decides each one.

## Telemetry

Runs per mode, triggers, tokens per mode, findings by severity and category, validated vs
unverified claims, integrity verdicts (consistent, inconsistent, unavailable), budget
exhaustions per mode, blocking findings later confirmed (the worker changed code at that
location and a test was added), and false-positive rate (from human review in the benchmark).

## Acceptance tests

1. Low-risk task with no integrity findings → the critic does not run.
2. An auth change with an introduced logic bug (fixture: inverted permission check, with tests
   that do not cover it) → a blocking `risk_review` finding with a valid quote, and the task
   returns to repair.
3. A critic claim quoting nonexistent code → downgraded to `unverified_claim`.
4. Risk-review budget exhausted and **no** pending integrity review → the task can still be
   `verified`, and the report lists the unreviewed triggers.
5. Risk-review budget exhausted **and** a contract-backed I6 finding pending → the
   `integrity_review` still runs from its reserved budget.
6. `critic.mode=off` alone, with a contract-backed I6 finding → `integrity_review` still runs.
   `integrity_review` impossible (`critic.integrityReview=false`, or a provider outage) → the
   finding is unresolved → headless final state is `blocked` (`integrity_review_required`),
   never `verified`.
7. An integrity verdict `consistent` whose `contractQuote` is not in the cited entry → treated as
   unavailable (unresolved).
