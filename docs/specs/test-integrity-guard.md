# Spec: Test (and Verification) Integrity Guard

- Package: `packages/core` (`integrity/`), with language-specific detectors in `packages/code-intel`
- Collaborators: [Task Contract](task-contract.md) (the only source of authorization), [Hallucination Firewall](hallucination-firewall.md) (F8 hook), [Verification Engine](verification-engine.md) (gate step 7), [Critic](critic.md) (`integrity_review` mode)

## Responsibility

Treat tests and verification configuration as **evidence, not obstacles**. Detect changes that
weaken the evidence: deleting tests or assertions, skipping, focusing, loosening expectations,
inflating timeouts, mutating fixtures, suppressing diagnostics, or disabling checks. Allow a
legitimate change only when **user-owned requirements** back it (the Task Contract) or the user
approves it. A model's own description of its change never counts. Surface everything in the
final report.

**Not responsible for:** judging whether the code under test is correct (verification does), or
blocking legitimate test updates (it requires justification and escalates; it does not
prohibit).

## Scope: what counts as verification surface

- **Test files:** matched by profile patterns (default: `**/*.{test,spec}.{ts,tsx,js,jsx}`,
  `**/__tests__/**`, `**/test_*.py`, `**/*_test.py`, `**/tests/**`, `**/*_test.go`), plus files
  the index sees importing a test framework.
- **Fixtures and snapshots:** `**/__snapshots__/**`, `**/*.snap`, `**/fixtures/**`,
  `**/testdata/**`, golden files.
- **Verification config:** test runner configs (`vitest.config.*`, `jest.config.*`,
  `pytest.ini`, `[tool.pytest]`, `conftest.py`), coverage configs, `tsconfig` strictness flags,
  lint configs (`eslint`, `ruff`, `biome`), CI workflows, and `.kai/project.json`.
- **Suppression comments in any file:** `@ts-ignore`, `@ts-expect-error`, `// eslint-disable`,
  `# type: ignore`, `# noqa`, `# pyright: ignore`, `//nolint`, `#[allow(...)]`.

## Detectors (AST-diff based; tree-sitter)

| ID | Detects | Default action |
|---|---|---|
| I1 `test_deleted` | A test case removed (`it`/`test`/`describe` block, `def test_*`, `func Test*`), or a whole test file deleted | flag (high severity) |
| I2 `assertion_removed` | Assertion count in a test decreases (`expect(`, `assert`, `self.assert*`, `t.Error*`) | flag (high severity) |
| I3 `skip_added` | `.skip`, `xit`, `xdescribe`, `it.todo`, `@pytest.mark.skip/xfail`, `@unittest.skip`, `t.Skip()` added | flag (high severity) |
| I4 `focus_added` | `.only`, `fit`, `fdescribe` added | **block** at the gate (it is never valid in a finished change). Allowed transiently during work |
| I5 `expectation_changed` | Literal expected value in an assertion changed (`toBe(3)` → `toBe(4)`, `assertEqual(x, "a")` → `"b"`) | flag (common and legitimate when behaviour changes, so justification is cheap) |
| I6 `assertion_weakened` | Matcher replaced by a weaker one: `toEqual` → `toBeDefined`/`toBeTruthy`/`not.toThrow`; `assertEqual` → `assertTrue`/`assertIsNotNone`; exact → `toContain`/`toMatch(/.*/)`; `assert x == y` → `assert x` | flag (high severity) |
| I7 `trivialized` | Assertion becomes tautological (`expect(true).toBe(true)`, `assert True`), or the test body is emptied or replaced with `pass` / `return` | **block** |
| I8 `timeout_inflated` | Timeout increased by more than 2× or set above 60 s (`jest.setTimeout`, `{timeout:}`, `@pytest.mark.timeout`) | flag |
| I9 `snapshot_updated` | Snapshot files changed, or the model ran the runner with `-u`/`--update-snapshots` | flag (justify per snapshot file) |
| I10 `fixture_mutated` | Fixture or golden files changed while the corresponding non-test code also changed in this task | flag |
| I11 `mocked_sut` | A mock or patch added that targets a symbol under change (the system under test), e.g. `vi.mock('../src/x')` where `src/x` is edited | flag (high severity) |
| I12 `suppression_added` | New suppression comments (any file) | flag (high severity). **block** if the suppressed line holds a hallucination-class diagnostic |
| I13 `check_disabled` | Verification config weakened: test paths excluded, coverage thresholds lowered, strictness flags turned off, lint rules disabled, CI steps removed, `.kai/project.json` checks removed or made non-required | flag (high severity). **block** if done to make a failing gate check pass |
| I14 `exception_swallowed` | Added `try/except: pass` or `catch {}` around code that previously raised in a failing test (heuristic) | flag (high severity) |

**block** findings must be fixed. **flag** findings must be resolved per the
[resolution matrix](#justification-and-review) before the gate can pass. Unmarked flags are low
severity.

## Justification and review

**Principle: the model cannot authorize weakening its own evidence.** Only two things can
authorize a flagged change: the **user-owned Task Contract** (including repository instruction
files as committed at task start; [task-contract.md](task-contract.md)), or an **explicit user
approval**. The model's own text never counts as authority: transaction `instruction`s, plan
steps, decisions, notes, interpretations, `proposed_criteria`, `complete_task` claims and the
free-text `reason` of a justification. The critic can *confirm* that a contract-backed change is
consistent with the contract, but it cannot authorize a change the contract does not back.

**Tool** (in the `tests` pack):
`justify_test_change(test_id_or_path, reason, contract_citation?: {entry_id, quote})`.

**Deterministic status of a justification** (computed by the Guard; no LLM):
- **`contract_backed`**: `contract_citation` passes the contract's citation check: the quote
  exists verbatim in a user-owned contract entry or a task-start instruction file, and is
  related to the changed test ([citation check](task-contract.md#citation-check-deterministic)).
- **`unbacked`**: there is no citation, or the citation is `not_found` or `unrelated`. The
  `reason` is kept for the report and for the user, but it carries no weight.

**Resolution matrix:**

| Finding class | `unbacked` | `contract_backed` |
|---|---|---|
| **Block** (I4 `.only`; I7 trivialized; I12 suppressing a hallucination-class diagnostic; I13 when it disables a failing gate check) | Must be fixed. Only an explicit user override (recorded as a contract `approval` entry) can lift it | Same: citations do not lift blocks |
| **Low-severity flag** (I5 expectation changed, I8 timeout, I9 snapshot, I10 fixture) | Needs **user approval** | **Resolved** (listed in the report) |
| **High-severity flag** (I1 test deleted, I2 assertion removed, I3 skip added, I6 assertion weakened, I11 mocked SUT, I12 other suppressions, I13 other config weakening, I14 exception swallowed) | Needs **user approval** | Needs **mandatory integrity review**: the critic in `integrity_review` mode confirms consistency with the cited contract text, **or** user approval |

**Mandatory integrity review is not optional and cannot run out of budget silently.**
- It uses the critic's **`integrity_review` mode**, which has its own **reserved budget**
  (`critic.integrityReviewTokens`). The optional risk review cannot consume that budget
  ([critic.md](critic.md#modes-and-budgets)).
- The review receives only the test diff, the cited contract entries, the changed production
  symbols and the integrity finding. It must answer `consistent` or `inconsistent` with
  evidence that passes the critic's quote validation.
- A finding is **unresolved** if the review is `inconsistent`, cannot run (`critic.integrityReview=false`,
  reserved budget exhausted, provider failure; `critic.mode=off` does not disable it) or cannot produce valid evidence. **An unresolved finding
  blocks `verified`.** Resolution then needs user approval:
  - interactive: `permission.request kind="integrity"` showing the diff, the citation and the
    critic's answer;
  - headless: the task ends **`blocked`** with reason `integrity_review_required` and the
    findings in the evidence bundle. It **never ends `verified`**.
- User approvals are recorded as contract `approval` entries (with `by: "user"`) that quote the
  approved finding, so the decision is auditable and replayable.

## When it runs

- **At the firewall (F8)** on every transaction, as cheap AST checks on changed test-surface
  files. Findings are attached to the edit result as early warnings: *"Note: this removes 2
  assertions from users.test.ts; justify with justify_test_change if intended."* Only I7 blocks
  at write time.
- **At the gate (step 7)**, the full-task diff against the task-start checkpoint is re-analyzed,
  so a change split across transactions is still caught.

## Events and telemetry

Events: `IntegrityFinding {kind, severity, path, detail, status: "unbacked"|"contract_backed", citation?}`,
`IntegrityReviewResolved {findingId, by: "critic"|"user", outcome: "consistent"|"inconsistent"|"approved"|"rejected"|"unavailable"}`.

Telemetry: findings by kind and severity; `contract_backed` vs `unbacked` justifications;
citation failures (`not_found`, `unrelated`); integrity reviews run, unavailable and
inconsistent; user approvals; and tasks ended `blocked` with `integrity_review_required`.
**`test_manipulation_incidents`** (flagged changes that reached the final diff without
resolution) is a headline correctness metric for the benchmark.

## Acceptance tests

1. Changing `expect(add(1,2)).toBe(3)` to `.toBe(4)` with only a transaction `instruction`
   saying "add now returns sum+1" → `unbacked` → the gate fails in headless mode (`blocked`,
   `integrity_review_required`), or asks the user in interactive mode.
2. Same, but the user's prompt says "change add() so it returns the sum plus one", and the
   justification quotes that sentence → `contract_backed` low-severity flag → resolved, and the
   change is listed in the report.
3. An assertion weakened (I6) with a valid contract citation → mandatory integrity review runs
   even when the risk-review budget is exhausted. If the review cannot run → unresolved → not
   `verified`.
4. `it.only` left in → gate block.
5. `@ts-ignore` added on a line with TS2339 → block.
6. `testPathIgnorePatterns` gains a failing test's path → I13 block.
7. A test file deleted along with the module it tests, with a citation of the user's "remove
   module X" → `contract_backed` high-severity flag → integrity review `consistent` → resolved.
8. A justification whose only support is the model's own plan or notes → `unbacked`, however
   detailed its `reason`.
