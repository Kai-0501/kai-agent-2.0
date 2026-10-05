# Spec: Selective Independent Critic

- Package: `packages/core` (`critic/`)
- Research: [OpenHands critics](../research/upstream/openhands.md), [synthesis §2.6](../research/synthesis.md#26-the-critic-is-the-most-expensive-mechanism-so-it-is-the-most-selective)
- Amended by: [ADR-0018](../adr/0018-openai-responses-and-profile.md) (evidence-bound findings, blocking vs advisory, stopping), [ADR-0023](../adr/0023-audit-corrections.md) (review obligations survive budgets)
- Profile policies: [harness profiles](harness-profiles.md#review-and-stopping-policy)

## Responsibility

For **higher-risk work, after deterministic verification has passed**, run a fresh-context
review that looks for defects deterministic checks cannot see: logic errors, security issues,
concurrency hazards, unhandled cases, unjustified test changes, and API contract breaks. Return
**evidence-cited findings**.

**Not responsible for:** style nits, re-running checks, or rewriting code. It reports; the
worker fixes.

## Triggers

The critic runs at gate step 9 only if **at least one** trigger fires (configurable) and
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
| Integrity findings that are `needs_review` or high severity | Test Integrity Guard |
| User request (`--critic=always`) | Config |

`critic.mode`: `auto` (default), `always`, or `off`.

## Review obligations

Some reviews are **required**, not optional. A **review obligation** is opened by:

- the Test Integrity Guard for any high-severity (I6, I11, I13) or `needs_review` finding
  ([test-integrity-guard](test-integrity-guard.md#justification-protocol));
- a risk trigger the user marked required (`critic.requiredTriggers`, e.g. `auth_paths`).

```ts
interface ReviewObligation {
  id: string; taskId: TaskId;
  kind: "integrity" | "user_required_trigger";
  source: string;                       // finding ID or trigger name
  status: "open" | "discharged_critic" | "discharged_user";
}
```

An obligation is discharged only by (a) a critic review whose input included the obligation's
evidence and whose output passed validation and contains no unresolved blocking finding on it,
or (b) the user's explicit approval (`permission.respond` to `kind="integrity"`). **Budget
exhaustion, a failed critic call, an unavailable route or a profile without structured review
never discharge an obligation.** With an obligation still open, the task cannot be `verified`;
it ends `implemented_unverified` with the obligation listed and a pending approval request.

## Inputs: the evidence bundle (no worker history)

```ts
interface CriticInput {
  objective: string;
  acceptanceCriteria: string[];
  constraints: string[];
  diff: string;                       // unified, task-start checkpoint → now; truncated per file if huge (with artifact ref)
  changedSymbols: SymbolCard[];       // before/after signatures for changed exported symbols
  context: { path: string; excerpt: string }[];  // callers of changed public symbols (≤ 10), selected by index
  verification: EvidenceBundle;       // what passed, what was pre-existing
  integrity: IntegrityFinding[];      // with justifications
  triggers: string[];                 // why the critic is running
}
```

Size target: ≤ 20k tokens. Diffs over budget are reviewed **per file group**, with up to 3
critic calls, each with the shared header.

## Execution

- A fresh interaction (new chain, or stateless), `purpose: "critic"`. The Governor picks
  `high` or `medium` by risk.
- **Tools:** read-only (`read_file`, `read_symbol`, `grep_search`, `read_artifact`, plus
  `code_intel` if active), enforced with `allowed_tools`, or by declaring only those tools when
  the snapshot marks `allowedToolsRestriction` unsupported. At most 8 tool turns.
- **Output** is submitted through a `submit_review(findings[])` function declared only for the
  critic. It is not done through `response_format`, because combining structured output with
  function calling in one interaction has not been verified for Interactions. Each finding:

```ts
interface CriticFinding {
  severity: "blocking" | "major" | "minor";
  category: "logic" | "security" | "concurrency" | "error_handling" | "api_contract" | "tests"
          | "requirements" | "integrity";
  path: string; line?: number;
  requirementRef?: string;       // "AC2", "objective", "constraint:…", or an obligation ID
  claim: string;                 // what is wrong
  evidence: string;              // quoted code (must match the file) and reasoning
  impact?: string;               // what goes wrong for whom
  reproduction?: { kind: "test" | "command"; command: string[] };  // must fail now to confirm
  suggestedCheck?: string;       // legacy alias of reproduction (free text)
}

type FindingDisposition =
  | "blocking_confirmed"         // its reproduction was run and failed now
  | "blocking_validated"         // exempt category (security, concurrency, api_contract, integrity) with location, requirement/impact and quote
  | "advisory_preference"        // no violated requirement and no concrete defect
  | "unverified_claim"           // quote or location does not exist
  | "not_reproduced"             // reproduction passed: the claimed defect did not show
  | "duplicate"                  // same fingerprint as an earlier finding, code unchanged
  | "resolved";                  // fixed in a later round
```

- **Evidence validation (deterministic).** Every `blocking` finding's `path:line` must exist,
  and its quoted code must occur in the current file (whitespace-normalized); otherwise
  `unverified_claim` (downgraded to `minor`). **Quote matching proves the code exists, not that
  the diagnosis is right**, so a blocking finding additionally needs either a `reproduction`
  that Kai runs (through the normal command policy, as a T3-style check) and that **fails** now,
  or an exempt category (`security`, `concurrency`, `api_contract`, `integrity`) with a
  `requirementRef` or `impact`. A reproduction that passes gives `not_reproduced` (minor).
  A blocking finding with neither a violated requirement nor a concrete defect is
  `advisory_preference`.
- **Deduplication:** fingerprint = `(path, enclosing symbol, category, normalized claim)`. A
  finding with the fingerprint of an earlier disposition is `duplicate` unless the code at its
  location changed since.
- Confirmed or validated blocking findings → `verification_failed`. They are delivered to the
  worker as repair items (counted against the repair budget) with their reproduction. Advisory,
  major and minor findings go into the final report and **never** become repair items.
- After the worker addresses blocking findings and the gate passes again, the critic **re-runs
  only on the files that changed since its last review** (incremental): at most twice per task by
  default, once for the `openai` profile ([profile policy](harness-profiles.md#review-and-stopping-policy)).
- **Stopping:** required checks passing with no open obligation and no confirmed blocking
  finding is a stopping condition. Optional review does not start a new round for advisory
  findings.

## Budget

`critic.maxTokensPerTask` (default 60k total input + output across critic calls). Required
reviews (open obligations) run first. If the budget is exceeded, the critic stops and the report
says *"critic budget exhausted"*. If only **optional** triggers remain unreviewed, the task can
still be `verified` on deterministic evidence, and the report lists the unreviewed risk triggers.
If any **obligation** is still open, the task is not `verified`
([obligations](#review-obligations)).

## Telemetry

Critic runs, triggers, tokens, findings by severity and category, validated vs unverified
claims, blocking findings later confirmed (the worker changed code at that location and a test
was added), and false-positive rate (from human review in the benchmark).

## Acceptance tests

1. Low-risk task → the critic does not run.
2. An auth change with an introduced logic bug (fixture: inverted permission check, with tests
   that do not cover it) → a blocking finding with a valid quote, and the task returns to repair.
3. A critic claim quoting nonexistent code → downgraded to `unverified_claim`.
4. Critic budget exhausted with only optional triggers left → the task is still verifiable, and
   the report lists the unreviewed triggers.
5. **Budget cannot clear an obligation:** an I11 (`mocked_sut`) high-severity finding opens an
   obligation; the critic budget is exhausted before it is reviewed → final state
   `implemented_unverified` with the open obligation and a pending `permission.request
   kind="integrity"`; user approval then allows `verified`.
6. A blocking `logic` finding whose reproduction passes → `not_reproduced`; a blocking style
   preference → `advisory_preference`; neither starts a repair round.
7. A repeated finding with unchanged code in round 2 → `duplicate`, not shown to the worker.
