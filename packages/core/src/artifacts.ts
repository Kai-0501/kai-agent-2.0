/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Artifact Store + Result Shaper: store every output in full; give the model bounded, parsed summaries.
 * Spec: docs/specs/artifact-store.md
 */
import type { ArtifactId, ContentHash, LineRange, SessionId } from "@kai/protocol";

export type ArtifactKind = "shell" | "test" | "build" | "typecheck" | "lint" | "search" | "diff" | "log" | "web";

export type ParsedOutput =
  | {
      readonly type: "test_run";
      readonly runner: string;
      readonly passed: number;
      readonly failed: number;
      readonly skipped: number;
      readonly failures: readonly { readonly testId: string; readonly file?: string; readonly line?: number; readonly message: string; readonly excerptRange: LineRange }[];
    }
  | {
      readonly type: "diagnostics";
      readonly tool: string;
      readonly items: readonly { readonly file: string; readonly line: number; readonly col?: number; readonly code?: string; readonly severity: "error" | "warning"; readonly message: string }[];
    }
  | { readonly type: "generic"; readonly errorLines: readonly number[]; readonly salientRanges: readonly LineRange[] };

export interface Artifact {
  readonly id: ArtifactId;
  readonly sessionId: SessionId;
  readonly kind: ArtifactKind;
  readonly command?: readonly string[];
  readonly exitCode?: number;
  readonly durationMs?: number;
  readonly bytes: number;
  readonly lines: number;
  readonly blob: ContentHash;
  readonly parsed?: ParsedOutput;
}

export interface ArtifactStore {
  /** Stores the (already redacted) bytes and returns the artifact; streaming variants exist for live processes. */
  create(input: { kind: ArtifactKind; bytes: Uint8Array; command?: readonly string[]; exitCode?: number; durationMs?: number }): Artifact;
  get(id: ArtifactId): Artifact | undefined;
  readLines(id: ArtifactId, range: LineRange): string;
  grep(id: ArtifactId, pattern: string, contextLines: number, maxTokens: number): { readonly text: string; readonly matches: number };
}

/** Parser plug-in (vitest, jest, node:test, pytest, tsc, pyright, eslint, ruff, generic...). */
export interface OutputParser {
  readonly id: string;
  matches(command: readonly string[] | undefined, head: string): boolean;
  parse(text: string, budgetMs: number): ParsedOutput;
}

export interface ShapedResult {
  readonly text: string; // what the model sees (≤ shapedMax tokens), always states what was omitted
  readonly inline: boolean; // true if the full output fit under inlineMax
  readonly artifactId: ArtifactId;
  readonly estTokensInjected: number;
  readonly estTokensRaw: number; // for the ESTIMATED spooling saving
}

export interface ResultShaper {
  shape(artifact: Artifact, opts: { readonly inlineMax: number; readonly shapedMax: number }): ShapedResult;
}
