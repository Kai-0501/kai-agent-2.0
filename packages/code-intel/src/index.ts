/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * @kai/code-intel: implements core's code-intelligence ports.
 *   - tree-sitter repository index, repo map (personalized PageRank), symbol cards, outlines
 *   - LSP manager (vscode-jsonrpc client, overlay documents, diagnostics deltas, probe files)
 *   - API Reality Checker (lockfile → installed → declarations → LSP probe → source → docs → web → unverified)
 * Specs: docs/specs/repo-index.md, docs/specs/api-reality-checker.md, docs/specs/hallucination-firewall.md
 * Decisions: docs/adr/0006, docs/adr/0008
 */
import type { ApiRealityPort, DiagnosticsProvider, HallucinationClass, Provenance, RepoMapProvider, SymbolResolver } from "@kai/core";

export type IndexedLanguage = "typescript" | "tsx" | "javascript" | "python";

/** The tree-sitter index implements symbol resolution and the repo map. */
export interface RepoIndex extends SymbolResolver, RepoMapProvider {
  /** Incremental update by content hash; Kai's own writes call this synchronously in the commit path. */
  update(paths: readonly string[]): Promise<void>;
  status(): { readonly files: number; readonly indexed: number; readonly languages: readonly IndexedLanguage[] };
}

/** How to launch a language server for a language (resolved from the project first). */
export interface LanguageServerSpec {
  readonly language: IndexedLanguage;
  readonly id: string; // "tsc-native" | "typescript-language-server" | "basedpyright" | "pyright"
  /** e.g. TS ≥ 7: ["tsc", "--lsp", "--stdio"] from the project's typescript package (verified on typescript@7.0.2). */
  readonly command: readonly string[];
  readonly selectWhen: string; // human-readable rule, e.g. "project typescript major >= 7"
  readonly pullDiagnostics: boolean | "probe";
  readonly settleMs: number; // 150
  readonly timeoutMs: number; // 1500 (TS) / 2500 (Python)
}

/** Per-server mapping of diagnostic codes or rules to hallucination classes (firewall spec table). */
export type HallucinationClassTable = Readonly<Record<string, Readonly<Record<string, HallucinationClass>>>>;

export interface LspManager extends DiagnosticsProvider {
  ensure(language: IndexedLanguage, signal: AbortSignal): Promise<{ readonly healthy: boolean; readonly server: string }>;
  definition(name: string, path?: string): Promise<readonly { readonly path: string; readonly line: number }[]>;
  references(name: string, path?: string): Promise<readonly { readonly path: string; readonly line: number }[]>;
  hover(name: string, path: string): Promise<string | undefined>;
  /** Probe document in the overlay, e.g. `import * as M from "pkg"; M.` → completion items. */
  probeMembers(languageModuleSpec: string, memberPath: readonly string[]): Promise<readonly string[]>;
  shutdownIdle(): Promise<void>;
}

export interface DependencyInfo {
  readonly name: string;
  readonly declared?: { readonly manifest: string; readonly range: string };
  readonly locked?: string;
  readonly installed?: string;
  readonly mismatch?: "not_installed" | "installed_differs_from_lock" | "not_declared";
  readonly typesAvailable: boolean;
}

export interface ApiFacts {
  readonly pkg: string;
  readonly version?: string;
  readonly provenance: readonly Provenance[];
  readonly symbol?: string;
  readonly kind?: "module" | "function" | "class" | "interface" | "type" | "const" | "namespace";
  readonly signatures?: readonly string[];
  readonly members?: readonly { readonly name: string; readonly kind: string; readonly signature?: string }[];
  readonly deprecated?: readonly string[];
  readonly notes?: readonly string[];
}

export interface ApiRealityChecker extends ApiRealityPort {
  dependencyInfo(pkg: string): Promise<DependencyInfo>;
  inspect(pkg: string, symbol?: string, opts?: { readonly maxMembers?: number }): Promise<ApiFacts>;
}
