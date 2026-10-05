/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Patch Engine: instruction gate, transactions on an overlay, strict matching (no fuzzy), ledger
 * version checks, and a WRITE-AHEAD JOURNAL (PREPARE → STAGE → VERIFY → SWAP → COMMIT) with a
 * deterministic, idempotent crash-recovery procedure.
 * Spec: docs/specs/patch-engine.md · Decisions: docs/adr/0007, amended by docs/adr/0016.
 */
import type { CheckpointId, ContentHash, LineRange, ToolCallId, TransactionId, TurnId } from "@kai/protocol";
import type { UserActionToken } from "./contract.js";
import type { FirewallReport } from "./firewall.js";

export type EditOp =
  | {
      readonly kind: "replace";
      readonly toolCallId: ToolCallId;
      readonly path: string;
      readonly oldString: string;
      readonly newString: string;
      readonly allowMultiple: boolean;
      readonly instruction: string;
    }
  | { readonly kind: "write"; readonly toolCallId: ToolCallId; readonly path: string; readonly content: string; readonly instruction?: string }
  | { readonly kind: "delete"; readonly toolCallId: ToolCallId; readonly path: string; readonly instruction: string }
  | { readonly kind: "rename"; readonly toolCallId: ToolCallId; readonly from: string; readonly to: string; readonly instruction: string };

export interface ProposedTransaction {
  readonly txnId: TransactionId;
  readonly turnId: TurnId;
  readonly edits: readonly EditOp[];
}

export interface OverlayFile {
  readonly content: string;
  readonly baseHash: ContentHash | null; // null = file did not exist
  readonly exists: boolean;
}

export interface Overlay {
  get(path: string): OverlayFile;
  set(path: string, content: string): void;
  remove(path: string): void;
  changedPaths(): readonly string[];
}

export type MatchRung = "exact" | "trailing_ws" | "indent_insensitive";

export interface MatchResult {
  readonly status: "ok" | "not_found" | "ambiguous" | "stale_view";
  readonly rung?: MatchRung;
  readonly ranges?: readonly LineRange[];
  /** On failure: up to 3 closest candidate regions (line-similarity ranked), with current text. */
  readonly candidates?: readonly { readonly range: LineRange; readonly text: string; readonly similarity: number }[];
}

/** Rejections happen before PREPARE: nothing was written. */
export type RejectReason =
  | "instructions_pending" // applicable instruction files not yet delivered this epoch (text returned with the rejection)
  | "not_found"
  | "ambiguous"
  | "stale_view"
  | "firewall"
  | "noop"
  | "invalid_path";

/** The write-ahead journal record (TransactionPrepared). Everything needed to finish OR undo the transaction. */
export interface PreparedTransaction {
  readonly txnId: TransactionId;
  readonly checkpointId?: CheckpointId;
  /** Paths in the exact order SWAP processes them. */
  readonly order: readonly string[];
  readonly files: readonly {
    readonly path: string;
    readonly op: "create" | "modify" | "delete"; // a rename is a delete of `from` plus a create of `to`
    readonly beforeHash: ContentHash | null; // null = did not exist
    readonly beforeBlob: ContentHash | null; // full pre-image (null only for create)
    readonly afterHash: ContentHash | null; // null = must not exist afterwards
    readonly afterBlob: ContentHash | null; // full post-image (null only for delete)
    readonly mode: number;
    readonly tempName: string; // ".<name>.kai-tmp-<txnId>-<n>", same directory
  }[];
  readonly reversePatchBlob: ContentHash;
}

/** Per-file disk state during recovery. */
export type RecoveryFileState = "AFTER" | "BEFORE" | "FOREIGN";

export type RecoveryOutcome =
  | { readonly txnId: TransactionId; readonly action: "rolled_forward" } // every file AFTER
  | { readonly txnId: TransactionId; readonly action: "aborted" } // every file BEFORE
  | { readonly txnId: TransactionId; readonly action: "rolled_back"; readonly restored: readonly string[] } // AFTER/BEFORE mix
  | { readonly txnId: TransactionId; readonly action: "conflict"; readonly foreign: readonly string[] }; // touch nothing; user decides

export type RecoveryChoice = { readonly path: string; readonly choice: "keep_disk" | "restore_before" | "restore_after" };

export interface TransactionResult {
  readonly txnId: TransactionId;
  /** aborted = external change detected at VERIFY; nothing was swapped. */
  readonly status: "applied" | "rejected" | "aborted" | "rolled_back";
  readonly rejectReason?: RejectReason;
  readonly abortReason?: "external_change";
  readonly perCall: readonly { readonly toolCallId: ToolCallId; readonly message: string; readonly hunk?: string; readonly isError: boolean }[];
  readonly firewall?: FirewallReport;
  readonly checkpointId?: CheckpointId;
  readonly files?: readonly { readonly path: string; readonly beforeHash: ContentHash | null; readonly afterHash: ContentHash | null }[];
}

export interface PatchEngine {
  /**
   * Instruction gate → overlay → match → ledger version check → firewall → checkpoint →
   * PREPARE (durable journal) → STAGE → VERIFY → SWAP → COMMIT marker. Invariant J1: no file
   * changes before PREPARE is durable.
   */
  apply(txn: ProposedTransaction, signal: AbortSignal): Promise<TransactionResult>;
  /** A journaled transaction toward the before-images; refuses (or 3-way merges) if files moved on. */
  rollback(txnId: TransactionId): Promise<{ readonly ok: boolean; readonly conflicts?: readonly string[] }>;
  /** Startup (before any other workspace work) and `kai recover`. Deterministic, idempotent; reads only journal + disk. */
  recover(): Promise<readonly RecoveryOutcome[]>;
  /** recovery.resolve (user action only): apply per-file choices for a RecoveryConflict. */
  resolveConflict(token: UserActionToken, txnId: TransactionId, choices: readonly RecoveryChoice[]): Promise<void>;
}
