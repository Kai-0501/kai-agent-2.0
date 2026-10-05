# Evaluation plan: does Kai make Gemini cheaper and more correct?

- Decision: [ADR-0014](../adr/0014-measurement-gated-mechanisms.md) (mechanisms must earn their place)
- Corpus design: [corpus.md](corpus.md)
- Telemetry source: [specs/telemetry.md](../specs/telemetry.md)

## Questions

1. **Efficiency:** does Kai reduce tokens and cost **per successfully completed task** compared
   with Gemini in a minimal harness, at non-inferior solve rate?
2. **Correctness:** does Kai reduce invented symbols, non-compiling edits, test manipulation,
   regressions and premature completion claims?
3. **Attribution:** which Kai mechanisms produce which effects (ablations)?

## Arms

| Arm | Description |
|---|---|
| **A0: mini-swe-agent + Gemini** | [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) (bash only, linear history) with `gemini-3.8-flash` through its LiteLLM path at default settings. This is the "raw Gemini with a minimal harness" baseline. |
| **A1: Gemini CLI** | Google's own harness, headless mode, default config (thinking HIGH, its own compression). This is the "best available Gemini-native harness" baseline. |
| **B: Kai (full)** | All mechanisms on, default thresholds. |
| **B−x: Kai ablations** | `--no-ledger`, `--no-spooling`, `--firewall=off`, `--firewall=advisory`, `--governor=fixed:high`, `--epochs=off` (one chain up to the hard limit), `--tools=all`, `--critic=off`, `--critic=always`, `--repair-controller=off`, `stateMode=stateless`. |

All arms: same model ID, same task prompts, same containers, same wall-clock and token caps, no
human in the loop. Kai's and Gemini CLI's permission policies are set to auto-allow inside the
sandbox container. A0 runs commands directly in the container.

## Metrics

### Outcome
| Metric | Definition |
|---|---|
| **Resolved** | The hidden evaluation tests pass and the hidden regression tests still pass. The agent never sees the hidden tests. |
| Resolve rate | resolved / tasks |
| **Premature completion rate** | Runs where the agent declared success but the task is not resolved. For Kai, declaration = `complete_task`; final `verified` vs resolved is reported separately |
| **Verified-but-wrong rate** (Kai only) | `verified` final state but not resolved. This measures verification blind spots |

### Efficiency (per task; aggregated over resolved tasks unless noted)
| Metric | Definition |
|---|---|
| **Tokens per resolved task** | Total input + output + thought (reported), plus cached input separately |
| **Cost per resolved task (USD)** | From reported usage and the versioned price table |
| Total cost per task (all tasks) | Includes failures, so harnesses that fail expensively are penalized |
| Repeated source reads | Share of source tokens sent whose (path, region, content hash) was already in the model's visible context. Computed offline from transcripts for A0/A1 by replaying their file reads; Kai records it natively |
| Context duplication | Share of input tokens per request that are byte-identical repeats of content earlier in the same request (excluding the cached-prefix mechanism) |
| Tool-output tokens | Tokens of tool results sent to the model, and their share of input |
| Thought tokens per resolved task | Reported `total_thought_tokens` |
| Wall-clock time | Per task, median and p90 |
| Turns per task | Model requests |

### Correctness
| Metric | Definition |
|---|---|
| **First-edit compile rate** | Share of edit actions after which the edited project still typechecks or compiles with no *introduced* errors. For A0/A1, computed offline by replaying each edit action's resulting tree through the same checker. For Kai, pre-write rejections count as "the model proposed a non-compiling edit" (reported both raw and post-firewall) |
| **Invented-symbol rate** | Hallucination-class diagnostics (per the [firewall table](../specs/hallucination-firewall.md#hallucination-class-diagnostic-table)) introduced per 100 changed lines, measured on **proposed** edits (Kai: including rejected ones; others: every edit action) |
| Invented-symbol escape rate | Hallucination-class diagnostics present in the **final** diff |
| **Test manipulation incidents** | Final diffs containing unjustified integrity findings (guard detectors run offline on all arms' final diffs) |
| Regressions | Hidden regression tests that pass at baseline but fail after the agent's change |
| Repair turns | Turns after the first failing check until a pass or the end |
| Human-review defects | Blind review of a stratified sample of 20 resolved diffs per arm, scored on a rubric (correctness risk, unnecessary changes, readability, test quality), 2 reviewers |
| Diff size and scope | Changed lines and files versus the reference solution (excess churn) |

## Statistics

- **Runs:** each (task, arm) is run **3 times** (Gemini at default temperature is
  nondeterministic). Use the per-task mean for paired comparisons.
- **Primary comparison (B vs A0):**
  - efficiency: median tokens per resolved task, with a paired bootstrap 95% CI on the
    per-task ratio (tasks resolved by both arms);
  - correctness: invented-symbol rate and premature completion rate (paired Wilcoxon
    signed-rank on per-task rates);
  - non-inferiority on resolve rate: B must be within −2 percentage points of A0 (one-sided 95%
    CI via paired bootstrap).
- **Ablations:** the same paired tests, B vs B−x, with Holm-Bonferroni correction across
  ablations.
- **Sizing:** with ~60 tasks × 3 runs, a 20% token reduction is detectable at typical per-task
  coefficients of variation (~0.5) with power over 0.8. A 2 pp non-inferiority margin on resolve
  rate needs more tasks. Report the CI honestly rather than claim significance.

## Harness

- **`packages/bench`** (Phase 2):
  - task loader (corpus format, below),
  - per-run fresh container from the task's image, with the repository at its pinned commit,
  - arm adapters: A0 (mini-swe-agent CLI with a Gemini config), A1 (Gemini CLI headless), B
    (Kai over the KSP stdio transport),
  - transcript capture: Kai's event log export, plus A0/A1 trajectories,
  - evaluator: apply hidden tests, run them, compute metrics, run offline integrity and
    hallucination analysis on all arms,
  - report generator: markdown plus JSON, per arm and ablation, with CIs.
- Runs use `service_tier: flex` where available to reduce cost. Latency metrics are then
  reported as indicative only, or re-measured on `standard` for a subset.
- Budget caps per run: e.g. 1.5M total tokens or 30 minutes. A run hitting a cap counts as
  unresolved, and its cost is included.

## Reporting

Each benchmark report contains:
1. setup: model ID, SDK versions, Kai commit, arms, corpus version, dates, price table version;
2. headline table: resolve rate, cost per resolved task, tokens per resolved task, invented
   symbol rate, premature completion, manipulation incidents (CIs);
3. per-category breakdowns (corpus categories);
4. ablation table with effect sizes;
5. Kai context composition per category, averaged per turn (stacked bar);
6. notable failures with links to transcripts.

Reports are committed to `docs/evaluation/reports/YYYY-MM-DD-<name>.md`.

## Calibration sweeps (Kai only)

- `epochSoftLimit` ∈ {32k, 64k, 128k}
- `shaper.inlineMax` ∈ {1k, 2k, 4k}
- `readFile.outlineThresholdLines` ∈ {200, 300, 600}
- Governor policy: rule table variants (e.g. R9 at `low` vs `medium`)
- `readFile.lineNumbers` on vs off

Choose defaults by tokens per resolved task subject to non-inferior resolve rate.
