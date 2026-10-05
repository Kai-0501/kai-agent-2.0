# ADR-0014: Measurement-gated mechanisms

- Status: Proposed
- Date: 2026-10-05
- Related: [evaluation/benchmark-plan.md](../evaluation/benchmark-plan.md), [ADR-0010](0010-telemetry.md), [research/upstream/swe-agent.md](../research/upstream/swe-agent.md)

## Context / problem

mini-swe-agent shows that a nearly scaffold-free harness reaches a high solve rate with strong
models. Every Kai mechanism adds latency, code and potential failure modes. The founding prompt
asks Kai to favour the smallest coherent architecture and to measure rather than rely on vibes.

## Considered alternatives

1. **Build everything in the founding brief and evaluate at the end.** Fast to start. Risks
   shipping mechanisms that cost more than they save, with no way to attribute effects.
2. **Expert judgment per mechanism.** Cheap, but it is exactly the "vibes" the founding brief
   rejects. Several plausible ideas (per-turn recompilation, fine-grained tool swapping)
   turned out counterproductive on closer analysis ([synthesis §2](../research/synthesis.md#2-where-the-evidence-changed-the-implied-design)).
3. **Benchmark-gated mechanisms with ablation flags from day one** (chosen).

## Decision

1. **Every optional mechanism has an ablation switch** (`--no-ledger`, `--no-spooling`,
   `--no-firewall`, `--firewall=advisory`, `--governor=fixed:<level>`, `--epochs=off`,
   `--tools=all`, `--critic=off|always`, `--repair-controller=off`) and emits telemetry
   attributable to it.
2. **A mechanism stays enabled by default only if** the benchmark shows, with the paired
   statistical test in the [benchmark plan](../evaluation/benchmark-plan.md), either:
   - lower median tokens per resolved task, with resolve rate not worse by more than the
     non-inferiority margin (2 percentage points), or
   - a better correctness metric (invented-symbol rate, first-edit compile rate, premature
     completion rate, test-manipulation incidents), with token cost not worse by more than 10%.
3. **Core invariants are exempt from removal, but not from optimization.** The completion gate
   (the model cannot declare `verified`), the append-only event log, and the transaction
   boundary for edits are safety and auditability properties. Their *cost* is still measured and
   optimized.
4. **Thresholds are configuration, not constants.** Epoch limits, inline-output limits, retry
   budgets and LSP timeouts live in a typed config with documented defaults, and are tuned by
   benchmark sweeps.

## Rationale

This keeps Kai honest and small. A mechanism that does not measurably help is removed, rather
than kept because it sounds right.

## Consequences

- The benchmark harness is built early (Phase 2 in the
  [implementation plan](../../IMPLEMENTATION_PLAN.md)), not at the end.
- Feature flags must be wired through config, the protocol and telemetry from the start.

## Unresolved questions

1. Benchmark size needed for adequate statistical power per ablation. See the benchmark plan's
   sizing section.
