# Spec: Repository Index, Repo Map and Symbol Cards

- Package: `packages/code-intel` (`index/`, `map/`)
- Decision: [ADR-0006](../adr/0006-repository-indexing.md)
- Research: [Aider's repo map](../research/upstream/aider.md)

## Responsibility

- Maintain a fresh, incremental **structural index** of the workspace: files, symbols
  (definitions with signatures and ranges), references and imports.
- Produce a **token-budgeted repository map** personalized to the current task.
- Produce **symbol cards** and **file outlines** for the ledger, briefs and tools.
- Answer **symbol resolution** queries (`read_symbol`, "did you mean", firewall existence
  checks) without LSP, and refine them with LSP when available.

**Not responsible for:** type-level resolution (members on types, overloads); that comes from
LSP ([ADR-0008](../adr/0008-code-intelligence-lsp.md)).

## Data model (SQLite)

```sql
CREATE TABLE files   (path TEXT PRIMARY KEY, content_hash TEXT, size INTEGER, mtime_ms INTEGER,
                      lang TEXT, parse_ok INTEGER, error_count INTEGER, indexed_at TEXT);
CREATE TABLE symbols (id INTEGER PRIMARY KEY, path TEXT, name TEXT, qualified TEXT, kind TEXT,
                      container TEXT, signature TEXT, start_line INTEGER, end_line INTEGER,
                      exported INTEGER, doc TEXT);
CREATE INDEX symbols_name ON symbols(name);
CREATE INDEX symbols_path ON symbols(path);
CREATE TABLE refs    (path TEXT, name TEXT, line INTEGER);
CREATE INDEX refs_name ON refs(name);
CREATE TABLE imports (path TEXT, module_spec TEXT, names_json TEXT, resolved_path TEXT, external_pkg TEXT);
```

- `kind`: `function | method | class | interface | type | enum | const | variable | module | field`.
- `signature`: the definition's header text, normalized: for functions, the first line through
  the opening brace or colon, joined if it spans lines, capped at 300 chars.
- `qualified`: `Container.name` (e.g. `UserService.findById`).
- `exported`: language-specific (TS `export`, Python not underscore-prefixed at module level or
  in `__all__`).

## Extraction

- `web-tree-sitter` with per-language `tags.scm` (`@definition.*`, `@reference.*`, `@name`)
  plus small **Kai queries** for signatures, containers, imports and exports. Kai queries are
  needed because standard `tags.scm` files do not capture signatures or import specifiers.
- Per file: parse; extract; count `ERROR`/`MISSING` nodes (stored as `error_count`, the
  **baseline** for the parse gate); resolve relative import specifiers to paths (TS: tsconfig
  `paths`/`baseUrl` and extension resolution; Python: package-relative resolution against
  `sys.path` roots discovered from the project config); mark bare specifiers as
  `external_pkg`.
- **Incremental update:** on a watcher event or a pre-use `stat` check, if `mtime`/`size`
  changed, re-hash. If the hash changed, re-extract in a worker thread. Kai's own writes update
  the index synchronously in the transaction commit path, so the firewall always sees fresh data.
- **Scope:** respect `.gitignore` and **`.kaiignore`** (gitignore syntax; paths Kai must never read, index, search or send to the model, e.g. secrets or proprietary data dirs. Enforced in `read_file`, `read_symbol`, `grep_search`, `glob` and the repo map), plus `index.exclude` (default: `node_modules`, `dist`,
  `build`, `.venv`, `vendor`, generated directories). Files over 1 MB are indexed as path only.

## Repo map

```ts
interface RepoMapRequest {
  budgetTokens: number;
  personalization: { paths: Record<string, number>; idents: Record<string, number> };
  exclude?: string[];            // paths already fully present in the seed
}
interface RepoMap { text: string; estTokens: number; files: string[]; symbols: number }
```

Algorithm (Aider-derived; Apache-2.0 concepts, reimplemented):
1. Build a directed multigraph from **referencing file → defining file**, per identifier.
2. Edge weight = `mul × sqrt(refCount)`, where `mul` starts at 1 and is:
   ×10 if the identifier is in `personalization.idents`;
   ×10 if the identifier is 8 or more characters and snake, camel or kebab case;
   ×0.1 if it starts with `_`;
   ×0.1 if it is defined in more than 5 files;
   ×50 if the referencing file is in `personalization.paths` with weight ≥ 1.
3. **Personalized PageRank** (power iteration, damping 0.85, tolerance 1e-6, at most 100
   iterations) with the personalization vector from paths (task mentions, files in scope, files
   with open failures, files edited this task). Use uniform personalization if empty.
4. Distribute each file's rank over its definitions, in proportion to the weights of incoming
   edges for each identifier.
5. Sort definitions by rank. **Binary search** the number of definitions whose rendering fits
   `budgetTokens` (accept within 10% under target).
6. **Render** grouped by file, showing each definition's signature line with its container
   chain, bodies elided with `⋮`, and files sorted by best rank:
   ```
   src/users/service.ts:
   │export class UserService {
   │  async findById(id: UserId): Promise<User | null>
   │  async create(input: CreateUserInput): Promise<User>
   ⋮
   ```
- PageRank runs in a worker. Results are cached by (graph version, personalization hash).
- Cold start: when the ledger is empty for the task, the Context Compiler requests a larger map
  (`repoMapColdStart`, default 8k tokens). Aider multiplies its 1k base by 8 when no files are in
  the chat; Kai's base is larger, so the multiplier is smaller.

## Symbol cards and outlines

```ts
interface SymbolCard {
  name: string; qualified: string; kind: string;
  path: string; range: LineRange;
  signature: string;
  doc?: string;          // first sentence, ≤ 120 chars
  refCount: number;      // number of referencing sites (index)
}
```
- A card is about 25–60 tokens. A file **outline** is the header (imports) plus the cards of
  top-level and member symbols with ranges.
- Cards are deterministic and cheap. They are the ledger's "cached summaries".

## Resolution API

```ts
interface SymbolResolver {
  resolve(name: string, opts?: { path?: string; kind?: string }): SymbolCard[];   // exact/qualified
  suggest(name: string, opts?: { path?: string; limit?: number }): SymbolCard[];   // did-you-mean
  definedAnywhere(name: string): boolean;                                          // firewall existence
  exportsOf(modulePath: string): string[];
}
```
`suggest` ranks by edit distance (Damerau-Levenshtein on identifiers), token overlap of
camel/snake parts, same-file and imported-module proximity, and refCount.

## Acceptance tests

1. Fixture repositories (TS app, Python package): every exported function appears in `symbols`
   with the correct range and signature.
2. Editing a file updates its symbols within the same transaction commit.
3. Map determinism: the same graph and personalization give an identical map. Size is at most
   the budget.
4. Personalization moves task-relevant files into the top 20% of the map, versus uniform
   personalization.
5. Indexing throughput: at least 2,000 files/min on a laptop for TS. A 10k-file repository's
   first index is under 5 min in the background, and the first map is usable within 30 s using
   priority indexing.
