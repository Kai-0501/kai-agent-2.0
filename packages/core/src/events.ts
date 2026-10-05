/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Append-only event log + projections. Spec: docs/specs/event-model.md · Decision: docs/adr/0004.
 * Only a representative subset of event payloads is typed here; the full catalog is in the spec.
 */
import type {
  ArtifactId,
  CheckpointId,
  ContentHash,
  EpochId,
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
import type { ContextManifest, EpochReason } from "./context.js";
import type { FirewallReport } from "./firewall.js";
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
  TaskCreated: { taskId: TaskId; objective: string; acceptance: string[]; scopeHints: string[] };
  TaskStateChanged: { taskId: TaskId; from: TaskState; to: TaskState; reason: string };

  EpochStarted: { epochId: EpochId; reason: EpochReason; previousEpochId?: EpochId };
  EpochBriefBuilt: { epochId: EpochId; briefBlob: ContentHash; sections: { name: string; estTokens: number }[]; llmDigestUsed: boolean };
  ToolLoadoutChanged: { epochId: EpochId; declarationsHash: ContentHash; tools: string[]; packs: string[] };
  PromptVersioned: { systemPromptHash: ContentHash; projectInstructionsHash: ContentHash };
  ContextElided: { epochId: EpochId; turnRange: [TurnId, TurnId]; estTokensFreed: number };

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
    delivery: "full" | "range" | "outline" | "stub" | "diff" | "edit_echo";
    estTokens: number;
  };

  TransactionProposed: { txnId: TransactionId; turnId: TurnId; editCount: number; paths: string[] };
  FirewallEvaluated: { txnId: TransactionId; report: FirewallReport };
  TransactionApplied: {
    txnId: TransactionId;
    files: { path: string; beforeHash: ContentHash | null; afterHash: ContentHash | null }[];
    reversePatchBlob: ContentHash;
  };
  TransactionRejected: { txnId: TransactionId; reason: string };
  TransactionRolledBack: { txnId: TransactionId; reason: string };
  CheckpointCreated: { checkpointId: CheckpointId; gitRef: string; reason: string };
  ExternalChangeDetected: { paths: string[]; detectedBy: "watcher" | "hash_check" };

  VerificationRunCompleted: {
    runId: VerificationRunId;
    tier: Tier;
    checkId: string;
    status: "pass" | "fail" | "skipped" | "error";
    classification?: "introduced" | "pre_existing" | "flaky";
    artifactId?: ArtifactId;
    fingerprints: string[];
  };
  TaskVerdict: { taskId: TaskId; state: FinalTaskState; evidence: EvidenceBundle };
  IntegrityFinding: { taskId: TaskId; kind: string; severity: "block" | "flag" | "info"; path: string; justified: boolean };
  StuckDetected: { taskId: TaskId; rule: string; evidence: string };
  ReplanStarted: { taskId: TaskId; briefBlob: ContentHash };
  CriticCompleted: { taskId: TaskId; blocking: boolean; findingCount: number; usage: TurnUsage };
}

export type KaiEventType = keyof KaiEventPayloads;

/** Append-only store. Each append commits the event and its projection updates atomically. */
export interface EventStore {
  append<T extends KaiEventType>(
    event: Omit<EventEnvelope<T>, "seq" | "ts" | "v">,
  ): EventEnvelope<T>;
  read(sessionId: SessionId, opts?: { afterSeq?: number; types?: readonly KaiEventType[] }): Iterable<EventEnvelope>;
  /** Content-addressed blob storage (written before referencing events). */
  putBlob(bytes: Uint8Array): ContentHash;
  getBlob(hash: ContentHash): Uint8Array;
  /** Rebuild all projections from events; must be byte-identical (tested invariant). */
  rebuildProjections(sessionId: SessionId): void;
}
