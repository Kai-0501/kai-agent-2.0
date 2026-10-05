# Specifications

These specs give enough detail that an implementer can build each subsystem without
re-deriving the architecture. Each one states the subsystem's **responsibility** (and what it
is *not* responsible for), its **interfaces** (TypeScript, mirrored in the
[scaffold](../../packages/)), **data flow**, **defaults**, the **events** it emits, its
**failure handling**, its **telemetry**, and its **acceptance tests**.

Interfaces here are normative in *shape* but not in exact naming. If implementation reveals a
better shape, update the spec and the scaffold in the same PR.

## Foundations

| Spec | Subsystem |
|---|---|
| [protocol.md](protocol.md) | Kai Session Protocol (KSP): runtime ↔ client contract |
| [event-model.md](event-model.md) | Event catalog, storage schema, projections, IDs |
| [tool-surface.md](tool-surface.md) | Core tools, capability packs, result formats, system prompt contract |

## Token efficiency

| Spec | Subsystem |
|---|---|
| [context-compiler.md](context-compiler.md) | Epoch seeds, ingress control, budgets, epoch briefs |
| [read-ledger.md](read-ledger.md) | What the model has seen, de-duplication, staleness |
| [artifact-store.md](artifact-store.md) | Spooling large outputs; Result Shaper parsers |
| [repo-index.md](repo-index.md) | tree-sitter index, repo map, symbol cards |
| [reasoning-governor.md](reasoning-governor.md) | Per-request `thinking_level` policy |

## Correctness

| Spec | Subsystem |
|---|---|
| [patch-engine.md](patch-engine.md) | Transactions, matching, atomic apply, rollback |
| [hallucination-firewall.md](hallucination-firewall.md) | Pre-write validation against repository reality |
| [api-reality-checker.md](api-reality-checker.md) | Library API facts from installed declarations |
| [verification-engine.md](verification-engine.md) | Tiers, profiles, task state machine, completion gate |
| [test-integrity-guard.md](test-integrity-guard.md) | Detecting test and verification weakening |
| [repair-replan-controller.md](repair-replan-controller.md) | Failure fingerprints, retry budgets, clean replans |
| [critic.md](critic.md) | Selective fresh-context review |

## Provider and measurement

| Spec | Subsystem |
|---|---|
| [gemini-provider.md](gemini-provider.md) | Native Interactions API provider |
| [telemetry.md](telemetry.md) | Token and correctness telemetry |

## Conventions used in all specs

- **Lines** are 1-based and ranges are inclusive (`{start: 10, end: 20}`), matching Gemini CLI's
  `read_file`.
- **Hashes** are SHA-256 hex of raw file bytes. `ContentHash` is the type.
- **Tokens** are always labelled *reported* (from API usage) or *estimated* (from Kai's
  estimator).
- **Defaults** are starting points, to be calibrated by the
  [benchmark](../evaluation/benchmark-plan.md) ([ADR-0014](../adr/0014-measurement-gated-mechanisms.md)).
- Every subsystem receives an `AbortSignal` for cancellable work and must leave the workspace
  consistent when aborted.
