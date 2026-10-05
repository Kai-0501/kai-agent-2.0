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
| [task-contract.md](task-contract.md) | User-owned, append-only requirements; citation check; authority levels |

## Token efficiency

| Spec | Subsystem |
|---|---|
| [context-compiler.md](context-compiler.md) | Epoch seeds, ingress control, request preflight, complete request accounting, instruction map, epoch briefs |
| [read-ledger.md](read-ledger.md) | What the model has seen, de-duplication, staleness |
| [artifact-store.md](artifact-store.md) | Spooling large outputs; Result Shaper parsers |
| [repo-index.md](repo-index.md) | tree-sitter index, repo map, symbol cards |
| [reasoning-governor.md](reasoning-governor.md) | Per-request effort intent policy (mapped to `thinking_level`, `reasoning.effort` or nothing by the profile) |

## Correctness

| Spec | Subsystem |
|---|---|
| [patch-engine.md](patch-engine.md) | Instruction gate, transactions, matching, write-ahead journal, crash recovery, rollback |
| [hallucination-firewall.md](hallucination-firewall.md) | Pre-write validation against repository reality |
| [api-reality-checker.md](api-reality-checker.md) | Library API facts from installed declarations |
| [verification-engine.md](verification-engine.md) | Tiers, profiles, task state machine, completion gate, established-only flakiness |
| [test-integrity-guard.md](test-integrity-guard.md) | Detecting test and verification weakening; contract-backed authorization; resolution matrix |
| [repair-replan-controller.md](repair-replan-controller.md) | Failure fingerprints, retry budgets, clean replans |
| [critic.md](critic.md) | Fresh-context review: optional risk review, mandatory integrity review |

## Providers, routes and profiles

| Spec | Subsystem |
|---|---|
| [harness-profiles.md](harness-profiles.md) | `gemini`, `openai`, `generic` profiles: prompts, tools, effort, context sizing, review and stopping |
| [gemini-provider.md](gemini-provider.md) | Native Interactions API provider |
| [openai-responses-provider.md](openai-responses-provider.md) | OpenAI Responses provider: API-key and ChatGPT subscription request builders |
| [compatible-endpoints.md](compatible-endpoints.md) | OpenAI-compatible endpoints: config, probes, validation, limited mode |
| [credentials.md](credentials.md) | Credential store, routes, usage classes |
| [chatgpt-sign-in.md](chatgpt-sign-in.md) | Sign in with ChatGPT (subscription credential route) |

## Learning, research and product surface

| Spec | Subsystem |
|---|---|
| [learning-service.md](learning-service.md) | Shared procedural learning: projects, retrospectives, skills, retrieval |
| [chrome-research.md](chrome-research.md) | Web search and page reading through the installed Chrome |
| [macos-client.md](macos-client.md) | macOS app: process model, KSP boundary, essential flows, lifecycle |
| [configuration.md](configuration.md) | Locations, layers, migration, identifiers, versioning |

## Measurement

| Spec | Subsystem |
|---|---|
| [telemetry.md](telemetry.md) | Token and correctness telemetry, project resource ledger |

## Conventions used in all specs

- **Lines** are 1-based and ranges are inclusive (`{start: 10, end: 20}`), matching Gemini CLI's
  `read_file`.
- **Hashes** are SHA-256 hex of raw file bytes. `ContentHash` is the type.
- **Tokens** are always labelled *reported* (from API usage) or *estimated* (from Kai's
  estimator). A reported field the route did not provide is *unknown* (`null`), never zero.
- **Defaults** are starting points, to be calibrated by the
  [benchmark](../evaluation/benchmark-plan.md) ([ADR-0014](../adr/0014-measurement-gated-mechanisms.md)).
- Every subsystem receives an `AbortSignal` for cancellable work and must leave the workspace
  consistent when aborted.
