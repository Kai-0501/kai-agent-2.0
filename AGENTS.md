# AGENTS.md: guidance for coding agents working on Kai Agent

You are working on **Kai Agent**, a local macOS coding agent whose runtime exists for **token
efficiency** and **verified correctness**. Gemini and ChatGPT/OpenAI models are first-class;
user-configured OpenAI-compatible endpoints run on a generic profile with the same protections.
Hold this codebase to the standards it enforces on the models.

> **Status:** architecture and type scaffold only, including the R1 release extension
> ([ADR-0017](docs/adr/0019-release-scope-macos-multi-provider.md)). Production implementation
> starts with [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) Phase 0. Files under
> `packages/*/src/` that begin with a `SCAFFOLD` header are type sketches, not implementations.

## Read first (in this order)

1. [README.md](README.md): thesis and status
2. [ARCHITECTURE.md](ARCHITECTURE.md): components, flows, principles P1–P8
3. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md): the phase you are working on
4. The spec(s) for the subsystem you are touching ([docs/specs/](docs/specs/)) and the relevant
   ADRs ([docs/adr/](docs/adr/)). For routes, profiles, endpoints, learning, research or the app,
   also read [docs/research/extension-2026-10.md](docs/research/extension-2026-10.md), including
   its open questions.

Do not re-derive the architecture. If something in a spec is wrong or underspecified, fix the
spec in the same PR as the code, and explain why in the PR description.

## Architectural invariants (do not break these without a superseding ADR)

1. **The append-only event log is the source of truth.** Never update or delete events. Every
   state change is an event, and its projection updates happen in the same SQLite transaction.
   Model context is a projection, built only by the Context Compiler.
2. **Only the Verification Engine can mark a task `verified`**, for every route and profile.
   No code path may set it from a model claim, a tool result, a critic budget, a learned skill
   or a client request.
3. **Nothing reaches the worktree except through a Patch Engine transaction**, which means
   overlay, firewall, hash check, then atomic commit, with a reverse patch recorded. Tools must
   not write files directly. Shell commands are the only other writers, and they are
   policy-gated and checkpointed.
4. **Nothing reaches the model except through the Context Compiler's seed or ingress path**, and
   every request passes the **preflight**. Every tool result (including web content and learned
   procedure cards) is shaped and counted in the manifest, together with replayed model output.
   There is no "just append the raw output" path.
5. **Clients use only the KSP protocol** (`packages/protocol`). `packages/cli` and `apps/macos`
   must not import runtime internals.
6. **Core depends on interfaces, not implementations.** `packages/core` must not import
   `provider-*`, `profiles`, `research-chrome` or `code-intel`. The composition root
   (`packages/runtime`) wires them.
7. **Provider-specific behaviour stays in the adapter and the profile.** Core branches on the
   capability snapshot, never on provider, route, profile or model names. A profile may change
   how the model is asked, never what is accepted.
8. **Every model request is reproducible** from its `ModelRequest` event (input blob,
   declarations hash, generation config as sent, route, profile version, capability snapshot,
   learning snapshot hash).
9. **Every mechanism has an ablation flag and telemetry**
   ([ADR-0014](docs/adr/0014-measurement-gated-mechanisms.md)).
10. **Reported vs estimated tokens are never mixed, and unknown is never zero.** API usage is
    *reported*; a field the route did not report is `null`. Kai's numbers are *estimated* and
    labelled as such everywhere. Plan usage, API spend and local compute are separate classes.
11. **Secrets stay in the runtime.** Credentials live only in the `CredentialStore` (Keychain or
    environment). They never appear in KSP messages (except the inbound `credentials.put`),
    events, blobs, logs, renderer state or model input.
12. **The user owns the objective.** User acceptance criteria change only through `task.amend`.
    Model plans, critic output and learned skills may add checks; they never narrow criteria or
    authorize weaker verification.
13. **Learned advice is advisory and scoped.** It never outranks explicit user instructions,
    applicable repository instructions or verification constraints. Changes to permissions,
    verification requirements, integrity policy, objectives or runtime code are never learned
    automatically. Each task pins its learning snapshot.
14. **Untrusted input never becomes instruction or policy.** Repository text, tool output and web
    pages are data. Web content cannot change objectives, permissions or research policy and
    cannot become a global lesson. Workspace config is restrict-only for safety keys.
15. **No silent route changes.** Never switch provider, route or account on quota, error or
    preference without the user; never send `local_only` data to a cloud route. Switches happen
    at safe boundaries, and provider-native replay never crosses a provider, route or account.
16. **No cross-store transactions.** Workspace, learning and app stores are separate; cross-store
    effects go through the outbox with idempotent IDs.
17. **Review obligations are discharged only by a validated review or the user.** Budgets,
    failures and profiles without structured review never discharge them.
18. **Research is read-oriented and isolated.** The browser uses Kai's own profile, the pipe
    transport and the filtering proxy; it never touches the user's everyday Chrome profile and
    never reaches private or local destinations.

## Token-efficiency rules (for features you build)

- Default to the **smallest sufficient output** in every model-facing format: stubs over
  re-sends, summaries plus artifact IDs over raw output, symbol cards over file bodies.
- Model-facing strings are part of the product. Keep tool descriptions and result messages
  short. CI enforces token budgets for tool declarations (core ≤ 3.5k estimated tokens).
- Never add content to the epoch prefix (system prompt, tool declarations, seed sections)
  without measuring its token cost and its benefit.
- Prefer deterministic computation over model calls. A new LLM call anywhere in the runtime
  needs an ADR or a spec update that justifies its cost, plus a budget and telemetry.
- Do not rewrite already-sent context in chained mode. Changes that bust the cache must be
  batched and justified (this includes effort changes on routes where they are not cache-safe,
  and elisions in local replay).
- Budgets scale with the model's effective context window; never assume Gemini's defaults are
  safe for a small local window.
- Learned procedures are retrieved deterministically under a hard budget; never add a growing
  memory file to every turn.

## Correctness rules (for features you build)

- **Reject before write. Report deltas, not absolutes.** Only *introduced* problems count against
  the model.
- Every rejection message must be **actionable**: location, cause, and what really exists.
- **Fail closed on uncertainty** in gates (e.g. if the baseline cannot be computed, treat
  failures as introduced), but **degrade gracefully** in advisory checks (LSP timeouts → a
  warning, not a crash).
- Never let a flaky or slow dependency (LSP, network, Chrome, an endpoint) block the loop
  indefinitely. Everything has a timeout and an `AbortSignal`.
- **Typed outcomes, not silence:** a parse failure is never "no results"; an unknown capability is
  `unknown`, not `supported`; an interrupted stream is a failure even if text arrived.
- Execute a tool call only after its response completed and the whole call validated (name,
  JSON, schema).
- A passing rerun never turns a newly introduced intermittent failure into accepted flakiness.

## Quality requirements for this repository

- TypeScript strict (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`), ESM,
  Node 24 LTS.
- Validate all external input with Zod: protocol messages, tool arguments, config, SDK
  responses at the boundary.
- Tests:
  - **unit tests** for every module, with no network;
  - **acceptance tests** as listed in each spec (fixtures under `fixtures/`);
  - **contract tests** against the live Gemini API (`pnpm test:contract`, requires
    `GEMINI_API_KEY`). Run them before any `@google/genai` upgrade; the OpenAI, compatible,
    live-auth, installed-Chrome and app suites are separate and gated
    ([plan](IMPLEMENTATION_PLAN.md#phase-0-foundations-s)). **Never report a live suite as
    passing unless it ran in its required environment;**
  - **property tests** for the event store (rebuild equality) and the patch engine (atomicity).
- Use the **fake provider** for loop and controller tests. Record real SSE fixtures with the
  contract suite for provider unit tests.
- Error handling: typed errors (`KaiError` with `code`, `retryable`). No silent catches.
- Logging: structured, to file. Never log API keys, file contents or prompts at info level.
- Dependencies: prefer small, maintained, permissively licensed packages. Record licences of
  vendored assets (tree-sitter grammars, queries) in `THIRD_PARTY_NOTICES.md`.

## Licensing rules

- Kai is implemented from scratch. Upstream projects are *inspiration*
  ([docs/research/](docs/research/)).
- **Never copy code from Serena's `src/serena/`** (GPL-3.0-or-later).
- **Never reuse another application's OAuth client ID or call private backend routes** (for
  example ChatGPT web backends). Use only the documented Sign in with ChatGPT open-source flow.
- Do not change Kai's licence or distribution settings (`release.distribution`); those are the
  owner's decisions.
- Record licences of bundled runtime libraries (`playwright-core`, Readability, pdf.js, the
  Keychain binding) in `THIRD_PARTY_NOTICES.md` when they are added.
- If you port a non-trivial algorithm from an MIT or Apache-2.0 project (e.g. Aider's repo-map
  heuristics), say so in a code comment with the source permalink, and keep Apache-2.0 notice
  obligations in mind.

## Commands

Phase 0 creates the tooling. Until then, only the scaffold typecheck exists.

| Command | Purpose |
|---|---|
| `pnpm i` | Install |
| `pnpm check` | Lint (Biome) + typecheck (all packages) + unit tests |
| `pnpm typecheck` | `tsc -b` across packages (works on the scaffold today) |
| `pnpm test` | Unit tests (vitest) |
| `pnpm test:contract` | Live Gemini contract tests (needs `GEMINI_API_KEY`) |
| `pnpm test:contract:openai` | Live OpenAI Responses contract tests (needs `OPENAI_API_KEY`; Phase 7+) |
| `pnpm test:contract:compat` | Compatible endpoint matrix (needs the listed servers; Phase 7+) |
| `pnpm test:live-auth` | Sign in with ChatGPT live suite (macOS, eligible account, browser; Phase 8+) |
| `pnpm test:smoke:chrome` | Installed-Chrome research smoke suite (macOS with Google Chrome; Phase 9+) |
| `pnpm test:smoke:app` | macOS app smoke suite (Phase 11+) |
| `pnpm bench -- --arms A0,B --tasks v0-alpha --runs 3` | Benchmark (Phase 2+) |
| `pnpm kai -- run "<prompt>"` | Run the CLI from source (Phase 1+) |

## Workflow

1. Pick the next unchecked item in the current phase of the implementation plan.
2. Read its spec. Write or extend the acceptance tests from the spec first where practical.
3. Implement the smallest change that passes them, with config, an ablation flag and telemetry.
4. Run `pnpm check`. For provider changes, also run `pnpm test:contract`.
5. Update the spec if the shape changed. Write a superseding ADR if a decision changed.
6. In the PR description: what changed, which acceptance criteria now pass, any benchmark
   impact (when available), and any spec or ADR updates.

## When you are unsure

- An API behaviour of Gemini is unclear: check [docs/research/gemini-api.md](docs/research/gemini-api.md)
  and its open questions. Write a contract test to find out, rather than guessing.
- An OpenAI, Sign in with ChatGPT, endpoint or Chrome behaviour is unclear: check
  [docs/research/extension-2026-10.md](docs/research/extension-2026-10.md#open-questions)
  (O1–O10) and use the conservative default listed there until a contract test answers it.
- Two specs seem to conflict: the ADR wins over the spec, and the spec wins over this file's
  summaries. Fix the conflict in the docs.
- A mechanism seems to add complexity without clear benefit: say so in the PR, and propose an
  ablation to measure it ([ADR-0014](docs/adr/0014-measurement-gated-mechanisms.md)).
