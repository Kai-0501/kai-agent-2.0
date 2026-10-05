# Architecture Decision Records

Each ADR records one significant decision: the problem, the alternatives considered, the
decision, the rationale, the consequences, and the questions still open.

**Status values:** `Proposed`, meaning accepted for implementation and revisable when evidence
from the benchmark or the live API contradicts it; `Accepted`, meaning implemented and validated;
`Superseded by ADR-NNNN` (or *partially superseded*, when a later ADR replaces only part of
a decision; the older ADR then links to it). All ADRs below are **Proposed**. Production
implementation has not started.

To change a decision, write a new ADR that supersedes the old one. Do not silently edit the
decision section of an existing ADR. Typo fixes and added links are fine.

| ADR | Decision | One-line summary |
|---|---|---|
| [0001](0001-implementation-language-runtime.md) | Implementation language and runtime | TypeScript (strict) on Node.js 24 LTS, pnpm workspace, no Effect |
| [0002](0002-runtime-client-boundary.md) | Runtime/client boundary | The workspace-owning runtime speaks a typed JSON-RPC protocol from day one. v1 hosts it in-process behind a CLI. |
| [0003](0003-gemini-provider-strategy.md) | Gemini provider strategy | Native Interactions API via `@google/genai`; chained state per epoch; stateless privacy mode; runtime capability probing |
| [0004](0004-durable-event-session-model.md) | Durable event and session model | Append-only SQLite event log plus projections; model context is a projection; content-addressed blobs |
| [0005](0005-context-compiler-and-epochs.md) | Context compiler and epochs | Budgeted epoch seeds plus ingress control within epochs; deterministic epoch briefs |
| [0006](0006-repository-indexing.md) | Repository indexing | tree-sitter tags + reference graph + personalized PageRank in SQLite; ripgrep; no embeddings in v1 |
| [0007](0007-editing-protocol.md) | Editing protocol | Gemini-shaped `replace`/`write_file`; transactions on an in-memory overlay; strict matching; atomic apply with reverse patches |
| [0008](0008-code-intelligence-lsp.md) | LSP / code-intelligence strategy | Own LSP client on `vscode-jsonrpc`; TS/JS and Python in v1; overlay diagnostics and probe files; tree-sitter fallback |
| [0009](0009-verification-architecture.md) | Verification architecture | Tiered checks; explicit task state machine; the model's completion claim triggers a gate; lazy baselines |
| [0010](0010-telemetry.md) | Telemetry | Per-turn records in SQLite with context composition; reconciled with API usage; optional OTel export |
| [0011](0011-provider-extensibility-boundary.md) | Provider extensibility boundary | Kai-owned canonical turn types plus capability descriptors plus typed provider options; no lowest common denominator |
| [0012](0012-tool-surface-and-dynamic-exposure.md) | Tool surface and dynamic exposure | 10 stable core tools in Gemini CLI shapes; capability packs switched at epoch boundaries; `allowed_tools` for phases |
| [0013](0013-workspace-safety-and-checkpoints.md) | Workspace safety and checkpoints | Hidden git-ref checkpoints with a private index; command policy; env sanitization; optional worktree mode |
| [0014](0014-measurement-gated-mechanisms.md) | Measurement-gated mechanisms | Every mechanism ships with an ablation flag and telemetry, and must win in the benchmark to stay on by default |
| [0015](0015-release-scope-macos-multi-provider.md) | Release scope | R1 is a macOS app with three model routes, shared learning and Chrome research, built on the unchanged trusted core |
| [0016](0016-providers-routes-profiles-capabilities.md) | Providers, routes, profiles, capabilities | Separate provider adapters, credential routes, harness profiles and tri-state capability snapshots; optional continuation; unknown usage stays unknown |
| [0017](0017-sign-in-with-chatgpt-route.md) | Sign in with ChatGPT route | The documented open-source SIWC flow as its own credential route: host identity, dynamic registration, PKCE + OIDC, Keychain, explicit quota handling |
| [0018](0018-openai-responses-and-profile.md) | OpenAI Responses and `openai` profile | Allowlist request builders per route, verbatim native replay, calibrated effort, evidence-bound critic and explicit stop/reopen rules |
| [0019](0019-openai-compatible-endpoints.md) | Compatible endpoints and `generic` profile | Chat Completions baseline, config as data, bounded probes, whole-call validation, limited mode without reliable tools |
| [0020](0020-shared-procedural-learning.md) | Shared procedural learning | Project-boundary retrospectives from deterministic evidence, a separate global store via outbox, scoped versioned skills, deterministic budgeted retrieval |
| [0021](0021-chrome-research.md) | Chrome research | `playwright-core` drives the installed Chrome with an app-owned profile over a pipe; three shaped research tools; filtering proxy; human handoff |
| [0022](0022-macos-desktop-shell.md) | macOS desktop shell | Electron main + sandboxed renderer; runtime in a `utilityProcess`; KSP over `MessagePort` |
| [0023](0023-audit-corrections.md) | Audit corrections | User-owned objectives, baseline-backed flakiness, durable prepared transactions, request preflight, complete manifests, instructions before mutation, review obligations |

## Template

```markdown
# ADR-NNNN: Title

- Status: Proposed
- Date: YYYY-MM-DD
- Related: specs, research notes, other ADRs

## Context / problem
## Considered alternatives
## Decision
## Rationale
## Consequences
## Unresolved questions
```
