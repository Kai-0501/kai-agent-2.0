# ADR-0006: Repository indexing strategy

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/repo-index.md](../specs/repo-index.md), [research/upstream/aider.md](../research/upstream/aider.md), [ADR-0008](0008-code-intelligence-lsp.md)

## Context / problem

The agent should go **search → resolve symbols → inspect narrow ranges → read the whole file only
when justified**. That needs a structural index: what is defined where, with which signature,
who references it, and what each file imports and exports. It must also produce a repository map
that fits a token budget, and stay fresh as files change. It must work for any language with a
grammar, and degrade gracefully when no language server is available.

## Considered alternatives

1. **ripgrep only** (mini-swe-agent, many CLIs). No structure. The model reads files to learn
   signatures, which is wasteful.
2. **ctags.** Broad language coverage, but definitions only (no references), weak signatures,
   and an external binary.
3. **tree-sitter tags plus a reference graph plus PageRank** (Aider). Definitions *and*
   references, any language with a `tags.scm`, incremental.
4. **LSP-only indexing** (`workspace/symbol`, `documentSymbol`). Precise, but slow to start, uneven
   across servers, and needs a running server per language.
5. **Embeddings / vector search.** Semantic recall, but adds a model dependency and indexing
   cost, goes stale, and is hard to explain. Unproven benefit over structural plus lexical search
   for code edits.

## Decision

**Option 3 as the always-available core, with LSP as a precision layer, and no embeddings in v1.**

- **Parser:** `web-tree-sitter` (WASM) with per-language grammars and `tags.scm` queries
  (vendored; licences recorded in `THIRD_PARTY_NOTICES`). v1 languages: TypeScript/TSX,
  JavaScript, Python. Then Go, Rust, Java and others when added.
- **Index tables (SQLite, same DB as [ADR-0004](0004-durable-event-session-model.md)):**
  `files(path, content_hash, mtime, size, lang, parse_ok)`,
  `symbols(id, path, name, kind, container, signature, start_line, end_line, exported, doc)`,
  `refs(path, name, line)`, `imports(path, module_spec, imported_names, resolved_path)`.
- **Freshness.** A file watcher (chokidar or `fs.watch` with a polling fallback) plus `stat`
  checks before use. Re-index by **content hash**, not mtime. Indexing runs in a worker thread,
  and the first full index is lazy and incremental (priority: files near the task's mentions).
- **Repo map.** Aider's algorithm, reimplemented: a reference graph with Aider's edge heuristics
  → **personalized PageRank** seeded by task mentions, files touched or read this task, files in
  failing-test stack traces, and diagnostics locations → **binary-search fit** to the map budget
  → signature-only rendering (definition line plus enclosing container, bodies elided).
- **Symbol cards.** Deterministic, cheap summaries (`name`, `kind`, `signature`, `doc` first
  line, `path:start-end`, reference count) used by the ledger, briefs and search results.
- **Text search** is ripgrep, with result capping and grouping by file.
- **LSP refines** (references, definitions, types) when a server is up
  ([ADR-0008](0008-code-intelligence-lsp.md)), but nothing *requires* LSP to function.

## Rationale

The tree-sitter graph is the best-proven budgeted map (Aider). It is language-generic,
incremental and cheap. Combined with symbol cards it directly enables "resolve symbols, then read
narrow ranges". Embeddings add cost and failure modes without evidence of benefit for this
workflow. They can be benchmarked later as a capability pack.

## Consequences

- Tag queries differ in quality per language. The parse-gate and map quality per language must be
  tested on fixture repositories.
- Very large monorepos (over 100k files) need path scoping (respect `.gitignore`, a configurable
  `index.include`/`index.exclude`) and lazy indexing. The first-session index time is a tracked
  metric.
- The PageRank computation needs care. Graph size scales with files, and it runs in a worker
  with a cached result keyed by (graph version, personalization vector).

## Unresolved questions

1. Grammar distribution: per-language npm WASM packages vs a vendored, pinned set.
2. Do we need cross-language edges (e.g. TS ↔ generated API clients)? Probably not in v1.
3. Should LSP `workspace/symbol` results backfill symbol kinds and signatures where tree-sitter
   tags are weak?
