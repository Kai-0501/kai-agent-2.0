/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Read Ledger: what source the model has seen (path, range, hash, epoch); de-duplication and staleness.
 * Also records instruction-file deliveries for the Patch Engine's pre-mutation instruction gate.
 * Spec: docs/specs/read-ledger.md · Decision: docs/adr/0016.
 */
import type { ArtifactId, ContentHash, EpochId, LineRange, SessionId, TaskId, TurnId } from "@kai/protocol";
import type { SymbolCard } from "./codeintel.js";

export type ReadDelivery = "full" | "range" | "outline" | "stub" | "diff" | "edit_echo" | "instructions";

export interface LedgerEntry {
  readonly sessionId: SessionId;
  readonly epochId: EpochId;
  readonly turnId: TurnId;
  /** Workspace-relative path, or an artifact for read_artifact slices. */
  readonly source: { readonly path: string } | { readonly artifactId: ArtifactId };
  readonly contentHash: ContentHash;
  readonly range: LineRange | "outline";
  /** Blob of the exact text delivered for `range` (enables sub-range staleness checks after remapping). */
  readonly regionTextBlob?: ContentHash;
  readonly symbol?: string;
  readonly delivery: ReadDelivery;
  readonly estTokens: number;
}

export type LedgerCheck =
  | { readonly action: "serve" }
  | { readonly action: "stub"; readonly seenAt: TurnId; readonly range: LineRange }
  | { readonly action: "serve_partial"; readonly missing: readonly LineRange[]; readonly seen: readonly LineRange[] }
  | { readonly action: "serve_diff"; readonly since: TurnId; readonly diff: string; readonly estTokens: number };

export type RegionSeen = "seen_current" | "seen_stale" | "never_seen";

export interface StaleRegion {
  readonly path: string;
  readonly range: LineRange;
  readonly seenAt: TurnId;
}

export interface FileReadSummary {
  readonly path: string;
  readonly hash: ContentHash;
  readonly symbols: readonly SymbolCard[];
  readonly stale: boolean;
}

export interface ReadLedger {
  check(req: {
    readonly path: string;
    readonly range?: LineRange;
    readonly symbol?: string;
    readonly epochId: EpochId;
    readonly currentHash: ContentHash;
    readonly refresh?: boolean;
  }): LedgerCheck;
  record(entry: LedgerEntry): void;
  /** Patch Engine version check: matched lines ± 3 context lines vs what the model saw. */
  regionSeen(path: string, range: LineRange, currentLines: readonly string[]): RegionSeen;
  onFileChanged(path: string, newHash: ContentHash, cause: "kai_write" | "external" | "formatter"): readonly StaleRegion[];
  /** Apply line shifts from an applied transaction's hunks to visible segments. */
  remap(path: string, hunks: readonly { readonly oldStart: number; readonly oldLines: number; readonly newLines: number }[]): void;
  filesRead(taskId: TaskId): readonly FileReadSummary[];
  /** Instruction gate: was this instruction file delivered (seed or notice) in this epoch at this hash? */
  instructionsDelivered(path: string, hash: ContentHash, epochId: EpochId): boolean;
}
