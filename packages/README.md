# packages/: TYPES-ONLY SCAFFOLD

> **This is not an implementation.** Every file here starts with a `SCAFFOLD` header and contains
> only TypeScript types and interfaces, plus one data object, `DEFAULT_CONFIG`. Nothing here runs
> an agent. Production implementation starts in [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md)
> Phase 0.

The scaffold makes the architectural boundaries concrete and compiler-checked:

| Package | Role | Depends on | Specs |
|---|---|---|---|
| `@kai/protocol` | KSP: the runtime ↔ client contract (IDs, methods, notifications, snapshots, reports) | — | [protocol](../docs/specs/protocol.md) |
| `@kai/core` | Domain ports and types: provider boundary, events, context compiler, ledger, artifacts, tools, patch engine, firewall, verification, integrity, repair, critic, governor, telemetry, config defaults | `@kai/protocol` | all of [docs/specs](../docs/specs/) |
| `@kai/provider-gemini` | Gemini Interactions provider types and mapping notes | `@kai/core`, `@kai/protocol` | [gemini-provider](../docs/specs/gemini-provider.md) |
| `@kai/code-intel` | Repo index, LSP manager and API reality checker types (implementing core ports) | `@kai/core`, `@kai/protocol` | [repo-index](../docs/specs/repo-index.md), [api-reality-checker](../docs/specs/api-reality-checker.md) |

Planned but not scaffolded: `@kai/runtime` (the composition root: config, workspace, git,
process runner, KSP server), `@kai/cli`, and `@kai/bench`. See
[ARCHITECTURE.md §3](../ARCHITECTURE.md#package-layout-planned).

## Check

```bash
pnpm i
pnpm typecheck   # tsc -b with TypeScript 7 (native), strict + exactOptionalPropertyTypes
```

## Rules

- `@kai/core` must never import `@kai/provider-gemini` or `@kai/code-intel`
  ([AGENTS.md invariant 6](../AGENTS.md#architectural-invariants-do-not-break-these-without-a-superseding-adr)).
- Clients import only `@kai/protocol` (invariant 5).
- When an interface changes during implementation, update the matching spec in the same PR.
