# ADR-0001: Implementation language and runtime

- Status: Proposed
- Date: 2026-10-05
- Related: [ADR-0003](0003-gemini-provider-strategy.md), [ADR-0008](0008-code-intelligence-lsp.md), [research/gemini-api.md](../research/gemini-api.md)

## Context / problem

Kai needs:
1. first-class access to the Gemini Interactions API, whose schema still moves (an incompatible
   change in May 2026),
2. an LSP client and language servers,
3. tree-sitter parsing for many languages,
4. a durable local store,
5. subprocess management, and
6. a typed client/runtime protocol.

The implementation will be done mostly by another coding agent (Cursor), so the stack should be
mainstream, strongly typed, and well represented in that agent's training data.

## Considered alternatives

| Option | For | Against |
|---|---|---|
| **TypeScript / Node.js** | First-party `@google/genai` with Interactions types generated from the API definition; LSP's reference implementation (`vscode-jsonrpc`, `vscode-languageserver-protocol`) is TypeScript; `typescript-language-server` and Pyright are Node-based; `web-tree-sitter` (WASM) needs no native toolchain; Pi, OpenCode, Cline, T3 Code and Gemini CLI are all TypeScript, so idioms carry over; one language for runtime, protocol and clients | Weaker CPU performance than Rust; needs a Node runtime; `better-sqlite3` is a native module |
| Python | First-party `google-genai`; Aider, SWE-agent and OpenHands precedent; MIT SolidLSP | Typed protocols and async process management are weaker; distribution (venvs) is harder; separate language for any web or desktop client |
| Rust | Single binary, performance (Codex, Goose) | **No first-party Gemini SDK**, so a fast-moving API would have to be hand-maintained; slower iteration; tree-sitter is good but LSP client work is heavier |
| Go | Single binary, good process control, a Google Go SDK exists | Interactions support not verified; weaker LSP client ecosystem; separate client language |

Libraries and frameworks considered:
- **Effect** (T3 Code, OpenCode): strong typed effects and DI, but a steep learning curve and a
  large conceptual surface. **Rejected.**
- **Bun**: fast, but less mature for long-running daemons that drive native language servers.
  Node 24 LTS is the conservative default.

## Decision

- **TypeScript in strict mode** (`strict`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) on **Node.js 24 LTS**, with ESM only.
- **pnpm workspaces** for the monorepo. **vitest** for tests. **Biome** for lint and format.
- **Zod 4** for runtime validation of protocol messages, tool arguments and config. Tool JSON
  Schemas are generated from Zod (`z.toJSONSchema`).
- **`@google/genai`**, pinned exactly and upgraded deliberately behind contract tests.
- **SQLite via `better-sqlite3`** (WAL mode, synchronous API) for the event log, projections
  and index. `node:sqlite` will be re-evaluated once it is stable in the LTS line.
- **`web-tree-sitter`** with WASM grammars. **`vscode-jsonrpc` + `vscode-languageserver-protocol`**
  for LSP. **ripgrep** for text search (system binary, or `@vscode/ripgrep`).
- **No Effect, no DI framework.** Use plain interfaces, constructor injection and explicit
  `AbortSignal` cancellation.
- **TypeScript compiler for Kai's own build:** `typescript@7` (the native compiler; 7.0.2 was
  released 2026-07-08; the scaffold typechecks with it). Kai's runtime code must **not** depend
  on the TypeScript compiler's JS API. In TS 7 it is exposed only as `typescript/unstable/*`
  (an IPC API to the native binary), and TS 6 is the last release with the classic in-process
  API. Parsing uses tree-sitter. Semantic questions go through LSP
  ([ADR-0008](0008-code-intelligence-lsp.md)).

## Rationale

The deciding factor is the **first-party SDK with generated Interactions types**. A
fast-changing API is best consumed through the vendor's generated types. LSP and tree-sitter
tooling are first-class in TypeScript, and every relevant harness Kai learns from is in
TypeScript. Plain TypeScript keeps the code readable for the next implementer (Pi's lesson). A
Rust rewrite of hot paths stays possible later, because the protocol boundary
([ADR-0002](0002-runtime-client-boundary.md)) isolates clients from the runtime language.

## Consequences

- Distribution needs Node. v1 targets developers who already have it. Single-file packaging
  (Node SEA) is postponed.
- `better-sqlite3` and possibly tree-sitter grammars bring native or WASM assets. CI must build
  on Linux and macOS (Windows best-effort in v1).
- CPU-heavy work (indexing big repos, PageRank) must run off the main event loop, in worker
  threads, so streaming and cancellation stay responsive.

## Unresolved questions

1. Is `node:sqlite` stable enough on Node 24 LTS to drop the native `better-sqlite3`
   dependency?
2. Which tree-sitter grammar distribution has the best licence and maintenance:
   per-language WASM packages, or a bundled pack?
3. Is Windows a v1 platform? It affects path handling, the process tree and the shell. Proposed
   answer: no, best-effort only.
