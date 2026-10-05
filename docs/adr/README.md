# Architecture Decision Records

Each ADR records one significant decision: the problem, the alternatives considered, the
decision, the rationale, the consequences, and the questions still open.

**Status values:** `Proposed`, meaning accepted for implementation and revisable when evidence
from the benchmark or the live API contradicts it; `Accepted`, meaning implemented and validated;
`Superseded by ADR-NNNN`. All ADRs below are **Proposed**. Production implementation has not
started.

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
