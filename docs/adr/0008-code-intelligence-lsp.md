# ADR-0008: LSP / code-intelligence strategy

- Status: Proposed
- Date: 2026-10-05
- Related: [specs/hallucination-firewall.md](../specs/hallucination-firewall.md), [specs/api-reality-checker.md](../specs/api-reality-checker.md), [specs/repo-index.md](../specs/repo-index.md), [research/upstream/opencode.md](../research/upstream/opencode.md), [research/upstream/codex-and-serena.md](../research/upstream/codex-and-serena.md)

## Context / problem

Deciding whether a symbol, member, import or export *really exists*, and what a library API's
real signature is, needs a type-aware view of the project and its dependencies. Language servers
provide that. They also have startup cost, memory use, per-server quirks, and diagnostics latency
that can stall an agent loop.

## Considered alternatives

1. **No LSP; tree-sitter plus heuristics only.** Fast, but cannot resolve members on types,
   re-exports or dependency APIs. Too weak for the firewall's core promise.
2. **Run full project typechecks** (`tsc --noEmit`, `pyright`) after every edit. Precise but slow
   (seconds to minutes) and coarse.
3. **Adopt an existing LSP abstraction.** Serena's application is GPL. SolidLSP (MIT) and
   multilspy are Python. OpenCode's client is Effect-based TypeScript and too entangled to reuse.
4. **A small Kai LSP client on `vscode-jsonrpc` + `vscode-languageserver-protocol`** (MIT),
   with a per-language server registry.

## Decision

**Option 4.**

- **`LspManager`** starts servers lazily per (workspace root, language), restarts them on crash
  with backoff, and shuts them down when idle. It keeps the server's document state in sync with
  Kai's **overlay**: proposed content is sent with `didOpen`/`didChange` and reverted after
  rejection.
- **v1 servers:**
  - TypeScript/JavaScript: **use the project's own TypeScript version.**
    - If the project uses **TypeScript ≥ 7**: the native compiler's built-in server,
      `tsc --lsp --stdio`. Verified on `typescript@7.0.2` (released 2026-07-08), whose `tsc`
      offers `--lsp` with `-stdio`, `-pipe` and `-socket` transports. The native compiler is
      much faster, which directly helps the firewall's latency budget.
    - If the project uses **TypeScript ≤ 6**: `typescript-language-server` (or `vtsls`)
      wrapping the project's `tsserver`. Projects without TypeScript (plain JS) use the bundled
      fallback version.
    The two paths are benchmarked for diagnostics latency and correctness on the same fixtures.
  - Python: `basedpyright` or `pyright`.
  The registry format allows adding gopls, rust-analyzer and others with no core changes.
  Binaries are resolved from the project first (`node_modules/.bin`, venv), then from a managed
  cache. Kai never installs anything into the project.
- **Diagnostics:** LSP 3.17 pull diagnostics (`textDocument/diagnostic`) where supported, else
  push diagnostics with a **settle window** (no new publish for 150 ms) and a hard **timeout**
  (default 1.5 s for TS, 2.5 s for Python; configurable). On timeout, the firewall falls back to
  tree-sitter checks and the LSP result is collected asynchronously before the next model
  request.
- **Diagnostic deltas, not absolutes.** Compare diagnostics for the affected files before and
  after the transaction, keyed by (code, normalized message, symbol), and ignoring line shifts.
  Only *introduced* diagnostics count.
- **Navigation:** `definition`, `references`, `hover`, `documentSymbol`, `workspace/symbol`,
  `implementation` and `rename` back the `read_symbol` core tool and the `code_intel` pack. Tools
  take **symbol names** (optionally `path`), and Kai resolves positions through the index. Gemini
  never supplies line/column coordinates.
- **Probe files** for the API Reality Checker: an in-memory document such as
  `import { X } from "pkg"; X.` is opened in the overlay to query real members (completion,
  hover, definition into `.d.ts`/`.pyi`) without touching disk.
- **Hallucination-class diagnostic codes** are maintained per server in a table (e.g. TS 2304,
  2305, 2307, 2339, 2551, 2552, 2724; Pyright `reportUndefinedVariable`,
  `reportAttributeAccessIssue`, `reportMissingImports`). See the
  [firewall spec](../specs/hallucination-firewall.md#hallucination-class-diagnostic-table).

## Rationale

The LSP protocol packages are stable, MIT and TypeScript-native. A thin client with an overlay is
small enough to own and lets Kai do *pre-write* validation. Existing integrations only do
post-write diagnostics. Name-addressed navigation avoids a known weak spot: models are poor at
precise line and column coordinates.

## Consequences

- Language servers are heavy: tsserver can use over 1 GB on large monorepos. Servers start lazily
  and their memory and latency are tracked in telemetry.
- Diagnostics from servers whose project config is broken (no `tsconfig`, no venv) are noisy. The
  Verification Engine's profile discovery detects this, and the firewall then downgrades
  LSP-based checks to advisory for that language.
- Cross-file effects: after an export changes, the firewall opens the top-N dependents (by
  reference count, N ≤ 10) in the overlay to collect introduced errors. Beyond N, the
  Verification Engine's typecheck tier catches the rest.

## Unresolved questions

1. How complete is TypeScript 7's native LSP for what Kai needs: pull diagnostics,
   `definition`, `references`, `hover`, `rename`, completions for probe files? Verify with the
   contract fixtures, and fall back to `typescript-language-server` with a TS 6 `tsserver` for
   any missing capability.
2. For TS ≤ 6 projects: `typescript-language-server` or `vtsls`? Benchmark latency and accuracy.
3. Is `basedpyright`'s rule-name-in-code reliable for classification?
4. Should servers be shared across concurrent sessions in the same workspace? Probably yes, with
   one overlay per session. Postponed until concurrent sessions exist.
