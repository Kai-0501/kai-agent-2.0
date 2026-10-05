# OpenCode

- **Repository:** [anomalyco/opencode](https://github.com/anomalyco/opencode) (formerly `sst/opencode`) @ `907b3bc5` (2026-10-02)
- **License:** MIT
- **Language/runtime:** TypeScript on Bun, built on Effect. Vercel AI SDK (`@ai-sdk/*`) for providers, SQLite through drizzle-orm, a client/server split (server, TUI, desktop and web clients, plus an SDK).
- **Studied as:** inspiration for code intelligence, LSP integration, permissions and provider architecture.

## Architecture

A server (`packages/opencode/src/server`) exposes sessions over HTTP and SSE. The TUI and other
clients are separate packages. Per-session processing lives in
[`src/session/`](https://github.com/anomalyco/opencode/tree/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/session):
`processor.ts`, `compaction.ts`, `overflow.ts`, `retry.ts`, `revert.ts` and `summary.ts`.

## Tool loop and tools

The usual tools: `read`, `edit`, `write`, `apply_patch`, `glob`, `grep`, `shell`, `lsp`, `task`
(subagent), `todo`, `webfetch`, `websearch`, `skill`, `question`, `plan`.

- **Tools chosen per model family.** GPT models (except `gpt-4` and OSS variants) get
  `apply_patch` instead of `edit`/`write`
  ([`registry.ts` L297–300](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/tool/registry.ts#L297-L300)).
- The `apply_patch` grammar comes from Codex: `*** Begin Patch / *** Update File: / @@ … /
  *** End Patch`
  ([`apply_patch.txt`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/tool/apply_patch.txt)).

## Code intelligence (LSP)

[`src/lsp/`](https://github.com/anomalyco/opencode/tree/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/lsp)
is a JSON-RPC LSP client with a registry of about 25 servers keyed by file extension (Deno,
TypeScript, ESLint, Oxlint, Biome, gopls, Pyright, Ty, rust-analyzer, clangd, …), installed or
launched on demand.

- **Post-edit diagnostics.** After an edit is written, the tool calls `lsp.touchFile(...)`,
  collects diagnostics, and appends *"LSP errors detected in this file, please fix:"* to the
  tool result
  ([`edit.ts` L197–201](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/tool/edit.ts#L197-L201)).
  This is immediate deterministic feedback, but the broken code is **already on disk**.
- **An `lsp` tool** gives the model `goToDefinition`, `findReferences`, `hover`,
  `documentSymbol`, `workspaceSymbol`, `goToImplementation` and call hierarchy
  ([`lsp.txt`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/tool/lsp.txt)).
  Positions are 1-based line/character, which is awkward for a model to supply. Kai's code-intel
  tools take *symbol names* and resolve positions internally.

## Context management

- **Pruning old tool outputs.** Walking backwards, the most recent `PRUNE_PROTECT = 40,000`
  tokens of tool output are kept. Older outputs are pruned only if at least
  `PRUNE_MINIMUM = 20,000` tokens can be freed
  ([`compaction.ts` L28–33](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/session/compaction.ts#L28-L33)).
  The minimum batch protects the prompt cache from being invalidated by tiny prunes.
- **Overflow compaction** triggers when token usage reaches the usable window minus a buffer of
  up to 20k
  ([`overflow.ts`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/session/overflow.ts)),
  followed by an LLM summary.

## Permissions

Rule-based `allow | ask | deny` per permission and glob pattern, with the last matching rule
winning, and session-scoped approvals
([`src/permission/`](https://github.com/anomalyco/opencode/tree/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/permission)).
Simple and adequate.

## Snapshots and revert

[`src/snapshot/index.ts`](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/snapshot/index.ts)
keeps a **separate git directory** under the app's data path (`--git-dir <data>/snapshot/<project>/<hash>
--work-tree <worktree>`), so snapshots never touch the user's repository objects or refs.

## Provider layer and Gemini

OpenCode uses the Vercel AI SDK. For Google models it sets
`thinkingConfig: {includeThoughts: true, thinkingLevel: "high"}` on **every** request to a
non-legacy Gemini model
([`transform.ts` L1280–1288](https://github.com/anomalyco/opencode/blob/907b3bc518fa48e90e8ec24dd327d13eee71c36c/packages/opencode/src/provider/transform.ts#L1280-L1288)).
This is the "maximum reasoning on every turn" behaviour Kai is designed to avoid. It also goes
through `generateContent` semantics rather than Interactions.

## Verification

Only post-edit LSP diagnostics. There is no verification state machine and no completion gate.

## Adopt

1. **An LSP client with a server registry** keyed by language and launched on demand
   ([ADR-0008](../../adr/0008-code-intelligence-lsp.md)).
2. **Diagnostics as part of the edit result.** Kai goes further: it checks the *proposed*
   content before writing and reports the *delta* against a baseline.
3. **Code-navigation tools** (definition, references, hover/type, workspace symbols), exposed
   as a capability pack and addressed by symbol name.
4. **Batched pruning with a minimum-gain threshold** when Kai must rewrite history in stateless
   mode.
5. **Rule-based allow/ask/deny permissions.**
6. **Snapshots in a git directory owned by Kai.** Kai combines this with T3 Code's ref naming.

## Reject or adapt

- **The AI SDK lowest-common-denominator provider** for Gemini, and hard-coded `thinkingLevel:
  high`.
- **Writing broken code first and asking the model to fix it.** Kai rejects
  hallucination-class errors before they are written.
- **Effect** (as with T3 Code, see [ADR-0001](../../adr/0001-implementation-language-runtime.md)).
- **About 25 LSP servers in v1.** Kai v1 supports TypeScript/JavaScript and Python properly,
  with a registry designed for more.
