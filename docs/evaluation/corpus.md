# Benchmark corpus design (v0)

A small, realistic, **repository-level** corpus that stresses the exact weaknesses Kai targets.
Target size: **60 tasks** for v0 (TypeScript-heavy plus Python), growing to about 150.

## Task format

```
bench/tasks/<task-id>/
  task.yaml          # metadata (below)
  prompt.md          # what the agent sees
  Dockerfile         # or image ref; pins toolchains and dependencies
  setup.sh           # installs deps at the pinned commit; must be deterministic
  hidden/            # NOT mounted for the agent
    eval_tests/      # tests that define success
    regression.sh    # broader suite that must keep passing
    reference.patch  # a known-good solution (for diff-size comparison and sanity checks)
```

```yaml
id: ts-zod-v3-schema-refactor
repo: github.com/<org>/<repo>
commit: <sha>
language: typescript
categories: [api_drift, cross_file_refactor]
difficulty: medium            # by reference-patch size and reviewer judgment
visible_tests: true           # agent may run existing tests
eval: { command: "pnpm vitest run hidden/eval_tests", timeout_s: 600 }
regression: { command: "hidden/regression.sh", timeout_s: 1200 }
caps: { tokens: 1500000, wall_clock_min: 30 }
traps: ["zod v4 API names exist in model memory; repo pins zod 3.23"]
license: MIT                  # of the source repository
```

## Sources

1. **Public SWE-style benchmarks (licence-checked subsets):**
   - SWE-bench Verified (Python): 12 tasks, stratified by difficulty;
   - a TypeScript/JavaScript subset from a multi-language SWE benchmark (for example
     Multi-SWE-bench or SWE-PolyBench): 10 tasks.
   These give comparability with published numbers. Their prompts and tests are used as they
   are.
2. **Kai-curated tasks** on pinned, permissively licensed open-source repositories: 38 tasks,
   each built to exercise one or more categories below, with hidden tests written by us.

Contamination: public benchmark tasks may be in training data. The curated tasks use recent
commits (after the model's release where possible) and new test code. Results are always
reported separately for public and curated tasks.

## Categories (each curated task is tagged with ≥ 1)

| Category | What it stresses | Example design | Target count |
|---|---|---|---|
| `invented_api_trap` | Plausible but nonexistent project APIs | The codebase has `findOne(where)`. Prompt phrasing ("find the user by email") invites `findByEmail` | 6 |
| `api_drift` | Model memory vs installed library version | The repository pins an older major version (e.g. a validation, ORM or HTTP library) whose API differs from the latest | 6 |
| `interface_misread` | Misunderstanding existing interfaces | Required argument order or option-object shapes that are easy to get wrong; tests check behaviour | 5 |
| `cross_file_refactor` | Multi-file consistency, transactions, firewall false positives | Rename or reshape a type used in 6–15 files | 5 |
| `big_output` | Spooling | A failing build or test producing more than 20k lines, where the relevant error is in the middle | 4 |
| `reread_pressure` | Ledger | A task requiring repeated consultation of one large (more than 1,500-line) file across many steps | 4 |
| `long_horizon` | Epochs, brief fidelity | A feature needing 25+ turns: schema, service, API and tests | 4 |
| `test_temptation` | Integrity guard | A spec conflicts with an existing (wrong) assertion, so the correct fix requires a *justified* test change; and a variant where the test is right and the tempting move is to weaken it | 4 |
| `repair_loop_bait` | Repair controller | A bug whose obvious fix is wrong (e.g. a symptom in module A, cause in module B) | 3 |
| `trivial` | Overhead on easy tasks | Rename a variable, fix a typo, add a log line | 4 |
| `no_tests_repo` | Honest `implemented_unverified` | A repository without a test command; the evaluation uses hidden tests | 2 |

Counts overlap because tasks carry multiple tags.

## Repository selection criteria

- Permissive licence (MIT, Apache-2.0, BSD).
- Builds and tests run offline inside the container after `setup.sh` (dependencies vendored or
  pre-fetched in the image).
- Test suite runtime under 5 minutes, or a meaningful targeted subset.
- A mix of sizes: small (< 5k LOC), medium (5–50k), large (50–300k).
- TS projects with a `tsconfig` and a working typecheck. Python projects with `pyproject` and a
  pinned environment.

## Quality control per task

1. The reference patch passes the hidden evaluation and regression tests. The unmodified repo
   fails the evaluation tests.
2. Two people validate that the prompt is unambiguous and the hidden tests do not over-specify
   implementation details.
3. Trap tasks: confirm the trap is real by running A0 three times. If A0 never falls for it, the
   trap may be too weak. Keep the task, but untag the category.
4. Record expected touched files and symbols for scope metrics.

## Growth plan

- v0 (60 tasks): used to calibrate defaults and decide ablations.
- v1 (~150 tasks): add Go and Rust when those languages get LSP support, and add
  database-migration and concurrency categories with critic-focused hidden tests.
- Keep a **frozen held-out set** (20%) that is never used for tuning, to report final numbers
  without overfitting thresholds.
