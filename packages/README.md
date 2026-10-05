# packages/: TYPES-ONLY SCAFFOLD

> **This is not an implementation.** Every file here starts with a `SCAFFOLD` header and contains
> only TypeScript types and interfaces, plus one data object, `DEFAULT_CONFIG`. Nothing here runs
> an agent. Production implementation starts in [IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md)
> Phase 0.

The scaffold makes the architectural boundaries concrete and compiler-checked:

| Package | Role | Depends on | Specs |
|---|---|---|---|
| `@kai/protocol` | KSP: the runtime ↔ client contract (IDs, methods, notifications, snapshots, reports) | — | [protocol](../docs/specs/protocol.md) |
| `@kai/core` | Domain ports and types: provider boundary and capability snapshots, credentials, harness profiles, learning, research, events, context compiler, ledger, artifacts, tools, patch engine, firewall, verification, integrity, repair, critic, governor, telemetry, config v2 defaults | `@kai/protocol` | all of [docs/specs](../docs/specs/) |
| `@kai/provider-gemini` | Gemini Interactions adapter types and mapping notes | `@kai/core`, `@kai/protocol` | [gemini-provider](../docs/specs/gemini-provider.md) |
| `@kai/provider-openai` | OpenAI Responses adapter types: route allowlists (compile-time checked), capability snapshot, terminal outcomes, model facts | `@kai/core`, `@kai/protocol` | [openai-responses-provider](../docs/specs/openai-responses-provider.md) |
| `@kai/provider-compatible` | Compatible-endpoint adapter types: probes, snapshot, whole-call validation, scope checks, experimental text-tool protocol | `@kai/core`, `@kai/protocol` | [compatible-endpoints](../docs/specs/compatible-endpoints.md) |
| `@kai/research-chrome` | Research worker types: Chrome discovery and validation, launch plan, profile lock, proxy policy, SERP adapter, extraction, worker IPC | `@kai/core`, `@kai/protocol` | [chrome-research](../docs/specs/chrome-research.md) |
| `@kai/code-intel` | Repo index, LSP manager and API reality checker types (implementing core ports) | `@kai/core`, `@kai/protocol` | [repo-index](../docs/specs/repo-index.md), [api-reality-checker](../docs/specs/api-reality-checker.md) |

Planned but not scaffolded: `@kai/runtime` (the composition root: config and migration, stores,
credential routes, Sign in with ChatGPT, learning wiring, research policy, workspace, git,
process runner, KSP server), `@kai/profiles` (the `gemini`, `openai` and `generic` harness
profiles), `@kai/cli`, `@kai/bench`, and `apps/macos` (Electron shell). See
[ARCHITECTURE.md §3](../ARCHITECTURE.md#package-layout-planned).

## Check

```bash
pnpm i
pnpm typecheck   # tsc -b with TypeScript 7 (native), strict + exactOptionalPropertyTypes
```

## Rules

- `@kai/core` must never import `@kai/provider-*`, `@kai/profiles`, `@kai/research-chrome` or
  `@kai/code-intel`
  ([AGENTS.md invariant 6](../AGENTS.md#architectural-invariants-do-not-break-these-without-a-superseding-adr)).
- Clients import only `@kai/protocol` (invariant 5). No protocol type carries secret material
  (invariant 11).
- Types that clients see (route states, Chrome status, projects, skills) live in
  `@kai/protocol`; core imports them rather than redefining them.
- When an interface changes during implementation, update the matching spec in the same PR.
