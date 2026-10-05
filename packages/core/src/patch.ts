/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Patch Engine: transactions on an overlay, strict matching (no fuzzy), ledger version checks,
 * atomic commit with rollback and reverse patches.
 * Spec: docs/specs/patch-engine.md · Decision: docs/adr/0007.
 */
import type { CheckpointId, ContentHash, LineRange, ToolCallId, TransactionId, TurnId } from "@kai/protocol";
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

export type RejectReason =
  | "not_found"
  | "ambiguous"
  | "stale_view"
  | "firewall"
  | "external_change"
  | "noop"
  | "invalid_path"
  | "instructions_pending"; // unseen nested instructions: withheld once, model reconsiders (docs/adr/0016)

/** Durable intent committed (TransactionPrepared) before the first rename (docs/specs/patch-engine.md#commit-protocol). */
export interface PreparedManifest {
  readonly txnId: TransactionId;
  readonly files: readonly {
    readonly path: string;
    readonly op: "write" | "create" | "delete" | "rename_from" | "rename_to";
    readonly beforeHash: ContentHash | null;
    readonly afterHash: ContentHash | null;
    readonly beforeBlob: ContentHash | null;
    readonly afterBlob: ContentHash | null;
    readonly tempPath?: string;
    readonly mode: number;
  }[];
  readonly order: readonly string[];
}

/** Restart recovery of a prepared transaction without an outcome (docs/specs/patch-engine.md#crash-recovery). */
export type RecoveryOutcome = "completed" | "rolled_back" | "abandoned" | "conflict";

export interface TransactionResult {
  readonly txnId: TransactionId;
  readonly status: "applied" | "rejected" | "rolled_back";
  readonly rejectReason?: RejectReason;
  readonly perCall: readonly { readonly toolCallId: ToolCallId; readonly message: string; readonly hunk?: string; readonly isError: boolean }[];
  readonly firewall?: FirewallReport;
  readonly checkpointId?: CheckpointId;
  readonly files?: readonly { readonly path: string; readonly beforeHash: ContentHash | null; readonly afterHash: ContentHash | null }[];
}

export interface PatchEngine {
  /** Build overlay → match → ledger version check → firewall → checkpoint → hash check → atomic commit. */
  apply(txn: ProposedTransaction, signal: AbortSignal): Promise<TransactionResult>;
  /** Apply the stored reverse patch if files still match afterHash; else 3-way merge or refuse. */
  rollback(txnId: TransactionId): Promise<{ readonly ok: boolean; readonly conflicts?: readonly string[] }>;
  /** Startup: resolve every TransactionPrepared without TransactionApplied/RolledBack from its manifest. */
  recover(signal: AbortSignal): Promise<readonly { readonly txnId: TransactionId; readonly outcome: RecoveryOutcome; readonly paths: readonly string[] }[]>;
}
