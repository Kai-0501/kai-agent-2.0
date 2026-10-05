/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Core-side ports for code intelligence. Implemented by @kai/code-intel (tree-sitter index, repo map,
 * LSP manager, API reality checker). Core depends on these interfaces only (AGENTS.md invariant 6).
 * Specs: docs/specs/repo-index.md, docs/specs/api-reality-checker.md · Decisions: docs/adr/0006, 0008.
 */
import type { LineRange } from "@kai/protocol";
import type { HallucinationClass } from "./firewall.js";

export type SymbolKind = "function" | "method" | "class" | "interface" | "type" | "enum" | "const" | "variable" | "module" | "field";

/** Deterministic 25–60-token symbol summary (the ledger's "cached summary"). */
export interface SymbolCard {
  readonly name: string;
  readonly qualified: string;
  readonly kind: SymbolKind;
  readonly path: string;
  readonly range: LineRange;
  readonly signature: string;
  readonly doc?: string;
  readonly refCount: number;
}

export interface SymbolResolver {
  resolve(name: string, opts?: { readonly path?: string; readonly kind?: SymbolKind }): readonly SymbolCard[];
  suggest(name: string, opts?: { readonly path?: string; readonly limit?: number }): readonly SymbolCard[];
  definedAnywhere(name: string): boolean;
  exportsOf(modulePath: string): readonly string[];
  outline(path: string): { readonly header: string; readonly symbols: readonly SymbolCard[] };
}

export interface RepoMapRequest {
  readonly budgetTokens: number;
  readonly personalization: { readonly paths: Readonly<Record<string, number>>; readonly idents: Readonly<Record<string, number>> };
  readonly exclude?: readonly string[];
}

export interface RepoMapProvider {
  map(req: RepoMapRequest): Promise<{ readonly text: string; readonly estTokens: number; readonly files: readonly string[] }>;
}

export interface Diagnostic {
  readonly path: string;
  readonly range: LineRange;
  readonly severity: "error" | "warning" | "info";
  readonly code?: string;
  readonly message: string;
  readonly source: "lsp" | "treesitter" | "command";
  readonly hallucinationClass?: HallucinationClass;
  /** Line-insensitive fingerprint used for deltas: (path, class|code, normalized message, symbol). */
  readonly fingerprint: string;
}

/** Overlay-aware diagnostics (LSP didOpen/didChange with proposed content, then revert). */
export interface DiagnosticsProvider {
  diagnosticsFor(
    files: readonly { readonly path: string; readonly content: string }[],
    opts: { readonly timeoutMs: number; readonly includeDependents: number },
    signal: AbortSignal,
  ): Promise<{ readonly diagnostics: readonly Diagnostic[]; readonly degraded: boolean }>;
  parseErrorCount(path: string, content: string): number; // tree-sitter ERROR/MISSING nodes
}

export type Provenance = "lockfile" | "installed" | "declarations" | "lsp" | "source" | "local_docs" | "web" | "unverified";

export type ExistenceAnswer =
  | { readonly exists: true; readonly provenance: Provenance }
  | { readonly exists: false; readonly provenance: Provenance; readonly nearest: readonly string[] }
  | { readonly exists: "unknown"; readonly reason: string };

export interface ApiRealityPort {
  exists(q: { readonly pkg: string; readonly exportName?: string; readonly memberPath?: readonly string[] }): Promise<ExistenceAnswer>;
}
