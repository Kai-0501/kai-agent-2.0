# Spec: Selective Independent Critic

- Package: `packages/core` (`critic/`)
- Research: [OpenHands critics](../research/upstream/openhands.md), [synthesis §2.6](../research/synthesis.md#26-the-critic-is-the-most-expensive-mechanism-so-it-is-the-most-selective)

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
  `code_intel` if active), enforced with `allowed_tools`. At most 8 tool turns.
- **Output** is submitted through a `submit_review(findings[])` function declared only for the
  critic. It is not done through `response_format`, because combining structured output with
  function calling in one interaction has not been verified for Interactions. Each finding:

```ts
interface CriticFinding {
  severity: "blocking" | "major" | "minor";
  category: "logic" | "security" | "concurrency" | "error_handling" | "api_contract" | "tests" | "requirements";
  path: string; line?: number;
  claim: string;                 // what is wrong
  evidence: string;              // quoted code (must match the file) and reasoning
  suggestedCheck?: string;       // a concrete test or command that would demonstrate it
}
```

- **Evidence validation (deterministic).** Every `blocking` finding's `path:line` must exist,
  and its quoted code must occur in the current file (whitespace-normalized). Findings that fail
  validation are **downgraded to `minor`** and marked `unverified_claim`. This keeps the critic
  from hallucinating defects.
- Blocking findings, if any, → `verification_failed`. They are delivered to the worker as repair
  items (counted against the repair budget), with the critic's `suggestedCheck` included. Major
  and minor findings go into the final report.
- After the worker addresses blocking findings and the gate passes again, the critic **re-runs
  only on the files that changed since its last review** (incremental), and at most twice per
  task.

## Budget

`critic.maxTokensPerTask` (default 60k total input + output across critic calls). If exceeded,
the critic stops and the report says *"critic budget exhausted"*. The task can still be
`verified` on deterministic evidence, and the report lists the unreviewed risk triggers.

## Telemetry

Critic runs, triggers, tokens, findings by severity and category, validated vs unverified
claims, blocking findings later confirmed (the worker changed code at that location and a test
was added), and false-positive rate (from human review in the benchmark).

## Acceptance tests

1. Low-risk task → the critic does not run.
2. An auth change with an introduced logic bug (fixture: inverted permission check, with tests
   that do not cover it) → a blocking finding with a valid quote, and the task returns to repair.
3. A critic claim quoting nonexistent code → downgraded to `unverified_claim`.
4. Critic budget exhausted → the task is still verifiable, and the report lists the unreviewed
   triggers.
