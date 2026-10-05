# Spec: API Reality Checker

- Package: `packages/code-intel` (`api/`), exposed through the `api_reality` capability pack and used internally by the Firewall (F3, F5, F6)
- Decision: [ADR-0008](../adr/0008-code-intelligence-lsp.md)

## Responsibility

Answer **"what does this external library actually provide, at the installed version?"** from
machine-verifiable local sources, *before* the model writes code against it and *when* the
firewall needs to check a call. Escalate to slower or less reliable sources only when local
sources are exhausted. Label every answer with its provenance.

**Not responsible for:** installing packages (it can *suggest* the install command; the model or
user runs it under policy), or general web research (that is the `research` pack, off by
default).

## Source ladder (in order)

| # | Source | TS/JS | Python | Provenance label |
|---|---|---|---|---|
| 1 | **Lockfile** (exact resolved version) | `package-lock.json`, `pnpm-lock.yaml`, `yarn.lock`, `bun.lock` | `uv.lock`, `poetry.lock`, `requirements*.txt` (pinned), `Pipfile.lock` | `lockfile` |
| 2 | **Installed package metadata** | `node_modules/<pkg>/package.json` (`version`, `types`/`typings`, `exports`) | `site-packages/<dist>-<ver>.dist-info/METADATA`, `RECORD`, `top_level.txt` (venv discovered from the profile, `.venv`, `VIRTUAL_ENV`, or `uv`/`poetry` env commands) | `installed` |
| 3 | **Type declarations** | `.d.ts` from the package or `@types/<pkg>` | `.pyi` stubs (in-package, `types-<pkg>`, typeshed bundled with Pyright) | `declarations` |
| 4 | **LSP probe** | A probe document in the overlay: `import * as M from "<pkg>"; M.` → completion items; `type T = typeof import("<pkg>")["<sym>"]` → hover | `import <mod>; <mod>.` → completion; hover on the symbol | `lsp` |
| 5 | **Installed source** | JS source in `node_modules` (entry and exports map) parsed with tree-sitter for exported names | Package `.py` source parsed with tree-sitter for `def`/`class`/`__all__` | `source` |
| 6 | **Package docs on disk** | `README.md`, `docs/` within the package | same | `local_docs` |
| 7 | **Web** (only with research enabled; through the [Chrome research service](chrome-research.md)) | Registry page / official docs for the **exact version**, opened with `web_open` and cited by source ID | PyPI / official docs | `web` (never overrides rungs 1–6; a web fact that contradicts installed declarations is reported as a conflict) |
| 8 | **Model memory** | — | — | `unverified` (the result says so explicitly) |

Runtime introspection of Python (`python -c "import x; inspect.signature(...)"`) executes
package import side effects. It is **allowed only** if the profile enables it
(`api.allowPythonIntrospection`). It counts as level 5b.

## Interfaces

```ts
interface ApiRealityChecker {
  dependencyInfo(pkg: string): Promise<DependencyInfo>;
  inspect(pkg: string, symbol?: string, opts?: { maxMembers?: number }): Promise<ApiFacts>;
  /** Firewall hook: does `pkg` export `name`, and does `name` have member `member`? */
  exists(q: { pkg: string; exportName?: string; memberPath?: string[] }): Promise<ExistenceAnswer>;
}
interface DependencyInfo {
  name: string;
  declared?: { manifest: string; range: string };   // e.g. package.json "^3.2.0"
  locked?: string;                                  // exact
  installed?: string;                               // exact, from disk
  mismatch?: "not_installed" | "installed_differs_from_lock" | "not_declared";
  typesAvailable: boolean;
}
interface ApiFacts {
  pkg: string; version?: string; provenance: Provenance[];
  symbol?: string;
  kind?: "module" | "function" | "class" | "interface" | "type" | "const" | "namespace";
  signatures?: string[];              // exact declaration text, ≤ 20 lines each
  members?: { name: string; kind: string; signature?: string }[];  // capped
  deprecated?: string[];              // from @deprecated JSDoc / warnings
  notes?: string[];                   // e.g. "symbol exists in v4 but not v3 (installed v3.9.1)"
}
type ExistenceAnswer = { exists: true; provenance: Provenance } | { exists: false; provenance: Provenance; nearest: string[] } | { exists: "unknown"; reason: string };
```

## Dependency index (cache)

The table `api_cache(pkg, version, symbol, facts_json, provenance, created_at)` is keyed by the
**exact installed version**. It is invalidated when the lockfile or the installed `package.json`
/ `dist-info` hash changes. Symbol facts are cheap to cache and are reused across sessions in the
same workspace. The cache is never shared across versions.

## Behaviour details

- **Version drift detection:** when the installed version differs from the lockfile or manifest,
  `dependencyInfo` reports a mismatch, and `inspect` adds a note. The firewall adds a warning to
  edits using that package.
- **Output budget:** `inspect` without a symbol returns the module's exported names grouped by
  kind (≤ 60 entries, then a count). With a symbol, it returns signatures and members (≤ 40). A
  typical answer is 150–600 tokens.
- **`exists` speed:** answered from the cache or `.d.ts`/`.pyi` parsing first (≤ 50 ms
  typical), and from the LSP probe only if needed.
- **Untyped JS/Python packages:** the source-level export list is used, and member existence on
  instances is `unknown`. The firewall then **does not block** (it warns) on members of untyped
  externals.

## Integration points

- **Firewall F3/F5/F6** uses `exists` and `dependencyInfo`.
- **Context Compiler:** when the objective or plan names a third-party package, the seed's
  relevant-code section includes a compact `ApiFacts` card for the symbols named (≤ 400 tokens
  total). This prevents memory-based guesses from the start.
- **Tool:** `inspect_api` and `dependency_info` in the `api_reality` pack.

## Telemetry

`api_queries`, `api_cache_hits`, `provenance` histogram, `version_mismatches`,
`unverified_answers`, and `firewall_blocks_external` (blocks caused by external API facts).

## Acceptance tests

1. A TS project with `zod@3` installed: `inspect("zod", "z.string")` gives a declaration-based
   signature. Asking for a v4-only API reports "not found in installed 3.x", with nearest names.
2. A Python project with `requests` installed and `types-requests` present: `inspect("requests",
   "Session.request")` gives the stub signature.
3. Lockfile says `1.2.0`, `node_modules` has `1.1.0` → `mismatch: installed_differs_from_lock`.
4. A model edit calling `axios.fetchJson()` (nonexistent) → firewall F6 blocks, listing real
   members from the declarations.
5. The cache is invalidated after a lockfile change.
