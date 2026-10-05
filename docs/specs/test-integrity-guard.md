# Spec: Test (and Verification) Integrity Guard

- Package: `packages/core` (`integrity/`), with language-specific detectors in `packages/code-intel`
- Collaborators: [Hallucination Firewall](hallucination-firewall.md) (F8 hook), [Verification Engine](verification-engine.md) (gate step 7), [Critic](critic.md)

## Responsibility

Treat tests and verification configuration as **evidence, not obstacles**. Detect changes that
weaken the evidence: deleting tests or assertions, skipping, focusing, loosening expectations,
inflating timeouts, mutating fixtures, suppressing diagnostics, or disabling checks. Require an
explicit, reviewable **justification** for legitimate changes. Surface everything in the final
report.

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
| I1 `test_deleted` | A test case removed (`it`/`test`/`describe` block, `def test_*`, `func Test*`), or a whole test file deleted | **flag** (justification required) |
| I2 `assertion_removed` | Assertion count in a test decreases (`expect(`, `assert`, `self.assert*`, `t.Error*`) | flag |
| I3 `skip_added` | `.skip`, `xit`, `xdescribe`, `it.todo`, `@pytest.mark.skip/xfail`, `@unittest.skip`, `t.Skip()` added | flag |
| I4 `focus_added` | `.only`, `fit`, `fdescribe` added | **block** at the gate (it is never valid in a finished change). Allowed transiently during work |
| I5 `expectation_changed` | Literal expected value in an assertion changed (`toBe(3)` → `toBe(4)`, `assertEqual(x, "a")` → `"b"`) | flag (common and legitimate when behaviour changes, so justification is cheap) |
| I6 `assertion_weakened` | Matcher replaced by a weaker one: `toEqual` → `toBeDefined`/`toBeTruthy`/`not.toThrow`; `assertEqual` → `assertTrue`/`assertIsNotNone`; exact → `toContain`/`toMatch(/.*/)`; `assert x == y` → `assert x` | flag (high severity) |
| I7 `trivialized` | Assertion becomes tautological (`expect(true).toBe(true)`, `assert True`), or the test body is emptied or replaced with `pass` / `return` | **block** |
| I8 `timeout_inflated` | Timeout increased by more than 2× or set above 60 s (`jest.setTimeout`, `{timeout:}`, `@pytest.mark.timeout`) | flag |
| I9 `snapshot_updated` | Snapshot files changed, or the model ran the runner with `-u`/`--update-snapshots` | flag (justify per snapshot file) |
| I10 `fixture_mutated` | Fixture or golden files changed while the corresponding non-test code also changed in this task | flag |
| I11 `mocked_sut` | A mock or patch added that targets a symbol under change (the system under test), e.g. `vi.mock('../src/x')` where `src/x` is edited | flag (high severity) |
| I12 `suppression_added` | New suppression comments (any file) | flag. **block** if the suppressed line holds a hallucination-class diagnostic |
| I13 `check_disabled` | Verification config weakened: test paths excluded, coverage thresholds lowered, strictness flags turned off, lint rules disabled, CI steps removed, `.kai/project.json` checks removed or made non-required | flag (high severity). **block** if done to make a failing gate check pass |
| I14 `exception_swallowed` | Added `try/except: pass` or `catch {}` around code that previously raised in a failing test (heuristic) | flag |

**block** findings must be fixed. **flag** findings require a justification before the gate can
pass.

## Justification protocol

- Tool (in the `tests` pack): `justify_test_change(test_id_or_path, reason, requirement_ref?)`,
  where `requirement_ref` points to the user objective, an acceptance criterion or an issue
  text.
- A justification is **valid** if it is specific (it names the behaviour change), and either:
  - the user objective or acceptance criteria explicitly call for changing that behaviour or
    test, or
  - the change aligns with an applied code change in the same task: the expected value moved in
    the same direction as a deliberate behaviour change named in the transaction `instruction`s.
  The Guard checks this deterministically through string and semantic hints. It is not an LLM
  judgment. Ambiguous cases are marked **needs_review**.
- **needs_review**, or **any high-severity flag** (I6, I11, I13), opens a **review
  obligation** and **triggers the Critic**, which gets the test diff and the justification
  ([critic.md](critic.md#review-obligations)). The obligation is discharged only by a validated
  critic review or the user's approval (`permission.request kind="integrity"`). If the critic
  cannot run **for any reason, including an exhausted critic budget, an unavailable route or a
  profile without structured review**, the final report shows the finding prominently and the
  task cannot be `verified` without the user's approval ([ADR-0016](../adr/0016-robustness-amendments.md)).
- Justifications must cite the **user-owned** objective or acceptance criteria (or a deliberate
  behaviour change named in transaction instructions). Model-derived criteria cannot justify
  weakening a test.
- Interactive mode: the user can approve a flagged change in one keystroke, which counts as a
  justification by the user.

## When it runs

- **At the firewall (F8)** on every transaction, as cheap AST checks on changed test-surface
  files. Findings are attached to the edit result as early warnings: *"Note: this removes 2
  assertions from users.test.ts; justify with justify_test_change if intended."* Only I7 blocks
  at write time.
- **At the gate (step 7)**, the full-task diff against the task-start checkpoint is re-analyzed,
  so a change split across transactions is still caught.

## Events and telemetry

Events: `IntegrityFinding {kind, severity, path, detail, justified, justificationRef?}`.

Telemetry: findings by kind, justified vs unjustified, critic escalations, user approvals.
**`test_manipulation_incidents`** (unjustified flagged changes that reached the gate) is a
headline correctness metric for the benchmark.

## Acceptance tests

1. Changing `expect(add(1,2)).toBe(3)` to `.toBe(4)` with no matching code change → flag,
   unjustified → gate fails.
2. Same, but the objective says "change add() to …" and the code changed accordingly → valid
   justification → pass, and the change is listed in the report.
3. `it.only` left in → gate block.
4. `@ts-ignore` added on a line with TS2339 → block.
5. `testPathIgnorePatterns` gains a failing test's path → I13 block.
6. A test file deleted along with the module it tests, and the objective says "remove module X" →
   justified.
7. A justification that cites only a model-derived criterion → `invalid`.
8. An I6 finding with the critic budget already exhausted → obligation open → task ends
   `implemented_unverified` until the user approves.
9. A model edit adding a test ID to `knownFlaky` in `.kai/project.json` → I13 finding.
