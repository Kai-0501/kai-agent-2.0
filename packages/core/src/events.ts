/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Append-only event log + projections. Spec: docs/specs/event-model.md · Decisions: docs/adr/0004,
 * amended by docs/adr/0015 and docs/adr/0016.
 * Only a representative subset of event payloads is typed here; the full catalog is in the spec.
 * Invariant: only user-action protocol handlers emit TaskContract*, RecoveryResolved and
 * IntegrityReviewResolved {by: "user"} (see UserOnlyEventType).
 */
import type {
  ArtifactId,
  CheckpointId,
  ContentHash,
  ContractEntry,
  EpochId,
  FailureClassification,
  FinalTaskState,
  LineRange,
  ReasoningEffort,
  SessionId,
  TaskId,
  TaskState,
  ToolCallId,
  TransactionId,
  TurnId,
  VerificationRunId,
} from "@kai/protocol";
import type { ContextManifest, EpochReason, InstructionFileRef, PreflightResult } from "./context.js";
import type { TaskContract, UserActionToken } from "./contract.js";
import type { CriticMode } from "./critic.js";
import type { FirewallReport } from "./firewall.js";
import type { IntegrityDetectorId, JustificationStatus } from "./integrity.js";
import type { PreparedTransaction, RecoveryChoice } from "./patch.js";
import type { CanonicalStep, TurnStatus, TurnUsage } from "./provider.js";
import type { EvidenceBundle, Tier } from "./verify.js";

export interface EventEnvelope<T extends KaiEventType = KaiEventType> {
  readonly seq: number; // store-assigned, strictly increasing
  readonly sessionId: SessionId;
  readonly taskId?: TaskId;
  readonly epochId?: EpochId;
  readonly turnId?: TurnId;
  readonly type: T;
  readonly v: number; // payload schema version
  readonly ts: string;
  readonly payload: KaiEventPayloads[T];
  readonly blobRefs?: readonly ContentHash[];
}

export interface KaiEventPayloads {
  SessionStarted: { workspaceId: string; model: string; runtimeVersion: string };
  SessionEnded: { reason: string };
  UserMessage: { text: string };
  SteeringMessage: { taskId: TaskId; text: string };
  /** The objective and acceptance live only in the contract. */
  TaskCreated: { taskId: TaskId; scopeHints: string[] };
  TaskContractRecorded: { taskId: TaskId; contract: TaskContract };
  TaskContractAmended: { taskId: TaskId; version: number; entry: ContractEntry; by: "user" };
  TaskStateChanged: { taskId: TaskId; from: TaskState; to: TaskState; reason: string };

  EpochStarted: { epochId: EpochId; reason: EpochReason; previousEpochId?: EpochId };
  EpochBriefBuilt: { epochId: EpochId; briefBlob: ContentHash; sections: { name: string; estTokens: number }[]; llmDigestUsed: boolean };
  ToolLoadoutChanged: { epochId: EpochId; declarationsHash: ContentHash; tools: string[]; packs: string[] };
  PromptVersioned: { systemPromptHash: ContentHash; projectInstructionsHash: ContentHash };
  ContextElided: { epochId: EpochId; turnRange: [TurnId, TurnId]; estTokensFreed: number };
  InstructionsIndexed: { files: InstructionFileRef[] };
  InstructionFilesChanged: { paths: string[]; hashes: ContentHash[] };
  PreflightDecision: {
    turnId: TurnId;
    projectedInputTokens: number; // ESTIMATED
    breakdown: PreflightResult["breakdown"];
    action: PreflightResult["action"];
    reshapedItems?: number;
  };

  ModelRequest: {
    turnId: TurnId;
    epochId: EpochId;
    provider: string;
    model: string;
    stateMode: "chained" | "stateless";
    previousInteractionRef?: string;
    effort: ReasoningEffort;
    allowedTools?: string[];
    inputManifest: ContextManifest;
    inputBlob: ContentHash;
    declarationsHash: ContentHash;
    generationConfig: Record<string, unknown>;
  };
  ModelResponse: {
    turnId: TurnId;
    status: TurnStatus;
    steps: CanonicalStep[];
    providerRefs: { interactionId?: string };
    usage: TurnUsage;
    latencyMs: number;
    ttftMs?: number;
  };
  ModelError: { turnId: TurnId; kind: string; retryable: boolean; attempt: number; message: string };
  ReasoningDecision: { turnId: TurnId; effort: ReasoningEffort; rule: string; inputsDigest: string };

  ToolCallRequested: { toolCallId: ToolCallId; providerCallId: string; name: string; args: unknown };
  ToolCallCompleted: { toolCallId: ToolCallId; ok: boolean; resultEstTokens: number; artifactIds: ArtifactId[] };
  SourceRead: {
    toolCallId: ToolCallId;
    path: string;
    contentHash: ContentHash;
    ranges: (LineRange | "outline")[];
    symbol?: string;
    delivery: "full" | "range" | "outline" | "stub" | "diff" | "edit_echo" | "instructions";
    estTokens: number;
  };

  TransactionProposed: { txnId: TransactionId; turnId: TurnId; editCount: number; paths: string[] };
  FirewallEvaluated: { txnId: TransactionId; report: FirewallReport };
  /** Before PREPARE: nothing was written (reasons include instructions_pending). */
  TransactionRejected: { txnId: TransactionId; reason: string };
  /** Write-ahead journal record, committed with synchronous=FULL before any workspace write (J1). */
  TransactionPrepared: { txnId: TransactionId; prepared: PreparedTransaction };
  /** Commit marker. */
  TransactionApplied: { txnId: TransactionId; recovered?: boolean };
  TransactionAborted: { txnId: TransactionId; reason: "external_change" | "crash_before_swap"; recovered?: boolean };
  TransactionRolledBack: { txnId: TransactionId; reason: string; recovered?: boolean };
  RecoveryConflict: { txnId: TransactionId; paths: string[] };
  RecoveryResolved: { txnId: TransactionId; choices: RecoveryChoice[]; by: "user" };
  CheckpointCreated: { checkpointId: CheckpointId; gitRef: string; reason: string };
  ExternalChangeDetected: { paths: string[]; detectedBy: "watcher" | "hash_check" };

  VerificationRunCompleted: {
    runId: VerificationRunId;
    tier: Tier;
    checkId: string;
    status: "pass" | "fail" | "skipped" | "error";
    classification?: FailureClassification;
    artifactId?: ArtifactId;
    fingerprints: string[];
  };
  TaskVerdict: { taskId: TaskId; state: FinalTaskState; evidence: EvidenceBundle };
  /** Feeds flake_history; written only from baseline states (no agent changes). */
  BaselineRunCompleted: { checkpointCommit: string; testId: string; passed: number; failed: number };
  IntegrityFinding: {
    taskId: TaskId;
    findingId: string;
    txnId?: TransactionId;
    kind: IntegrityDetectorId;
    severity: "low" | "high";
    action: "block" | "flag" | "info";
    path: string;
    detail: string;
    status: JustificationStatus;
    citation?: { entryId: string; quote: string };
  };
  IntegrityReviewResolved: {
    findingId: string;
    by: "critic" | "user";
    outcome: "consistent" | "inconsistent" | "approved" | "rejected" | "unavailable";
  };
  StuckDetected: { taskId: TaskId; rule: string; evidence: string };
  ReplanStarted: { taskId: TaskId; briefBlob: ContentHash };
  CriticRequested: { taskId: TaskId; mode: CriticMode; triggers: string[] };
  CriticCompleted: { taskId: TaskId; mode: CriticMode; findingCount: number; blocking: boolean; budgetExhausted: boolean; usage: TurnUsage };
}

export type KaiEventType = keyof KaiEventPayloads;

/** Events that only KSP user-action handlers may append (event-model invariant 8). */
export type UserOnlyEventType = Extract<KaiEventType, "TaskContractRecorded" | "TaskContractAmended" | "RecoveryResolved">;

/** Append-only store. Each append commits the event and its projection updates atomically. */
export interface EventStore {
  append<T extends Exclude<KaiEventType, UserOnlyEventType>>(
    event: Omit<EventEnvelope<T>, "seq" | "ts" | "v">,
  ): EventEnvelope<T>;
  /** User-only events (and IntegrityReviewResolved/PermissionResolved with by: "user") require the capability. */
  appendUserAction<T extends KaiEventType>(token: UserActionToken, event: Omit<EventEnvelope<T>, "seq" | "ts" | "v">): EventEnvelope<T>;
  /**
   * PREPARE: fsync the referenced blobs, then commit TransactionPrepared with synchronous=FULL.
   * Resolves only once the record is durable against power loss.
   */
  appendDurable(event: Omit<EventEnvelope<"TransactionPrepared">, "seq" | "ts" | "v">): EventEnvelope<"TransactionPrepared">;
  read(sessionId: SessionId, opts?: { afterSeq?: number; types?: readonly KaiEventType[] }): Iterable<EventEnvelope>;
  /** Content-addressed blob storage (written before referencing events). */
  putBlob(bytes: Uint8Array): ContentHash;
  getBlob(hash: ContentHash): Uint8Array;
  /** Rebuild all projections from events; must be byte-identical (tested invariant). */
  rebuildProjections(sessionId: SessionId): void;
}
