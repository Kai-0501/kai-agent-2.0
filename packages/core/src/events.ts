/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Append-only event log + projections of the WORKSPACE store. The global learning store and the
 * app store have their own logs; no transaction spans stores (docs/specs/event-model.md#stores).
 * Spec: docs/specs/event-model.md · Decisions: docs/adr/0004, docs/adr/0016, docs/adr/0020, docs/adr/0021, docs/adr/0023.
 * Only a representative subset of event payloads is typed here; the full catalog is in the spec.
 * Invariant: no payload contains secret material (keys, tokens, codes, verifiers, state, nonce, cookies).
 */
import type {
  AppliedEffort,
  ArtifactId,
  CapabilitySnapshotId,
  ChromeStatus,
  CheckpointId,
  ContentHash,
  CredentialRef,
  EffortLevel,
  EpochId,
  FinalTaskState,
  LearningJobId,
  LineRange,
  ProjectId,
  ProjectOutcome,
  ResearchOpId,
  RouteId,
  RouteState,
  SessionId,
  SourceId,
  TaskId,
  TaskState,
  ToolCallId,
  TransactionId,
  TurnId,
  UsageClass,
  VerificationRunId,
} from "@kai/protocol";
import type { ContextManifest, ContinuationMode, EpochReason, PreflightAction } from "./context.js";
import type { FindingDisposition } from "./critic.js";
import type { FirewallReport } from "./firewall.js";
import type { RequestPurpose } from "./governor.js";
import type { FinalizationTrigger, SkillVersionRef } from "./learning.js";
import type { RecoveryOutcome } from "./patch.js";
import type { CanonicalStep, CapabilitySnapshot, TurnStatus, TurnUsage } from "./provider.js";
import type { ResearchOutcome, SourceRecord } from "./research.js";
import type { EvidenceBundle, FailureClassification, Tier } from "./verify.js";

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
  SessionStarted: { workspaceId: string; projectId: ProjectId; routeId: RouteId; profile: string; model: string; runtimeVersion: string };
  SessionEnded: { reason: string };
  UserMessage: { text: string };
  SteeringMessage: { taskId: TaskId; text: string };
  TaskCreated: { taskId: TaskId; projectId: ProjectId; objective: string; acceptance: string[]; scopeHints: string[]; owner: "user" };
  /** The only way user-owned criteria change (docs/adr/0023). */
  TaskAmended: { taskId: TaskId; objective?: string; acceptance?: string[]; by: "user" };
  DerivedCriteriaRecorded: { taskId: TaskId; criteria: string[] };
  TaskStateChanged: { taskId: TaskId; from: TaskState; to: TaskState; reason: string };

  EpochStarted: { epochId: EpochId; reason: EpochReason; previousEpochId?: EpochId; continuation: ContinuationMode };
  EpochBriefBuilt: { epochId: EpochId; briefBlob: ContentHash; sections: { name: string; estTokens: number }[]; llmDigestUsed: boolean };
  ToolLoadoutChanged: { epochId: EpochId; declarationsHash: ContentHash; tools: string[]; packs: string[] };
  PromptVersioned: { systemPromptHash: ContentHash; projectInstructionsHash: ContentHash };
  ContextElided: { epochId: EpochId; turnRange: [TurnId, TurnId]; estTokensFreed: number };
  RequestPreflighted: { turnId: TurnId; estimatedRequestTokens: number; limit: number; actions: PreflightAction[] };
  InstructionsWithheldMutation: { turnId: TurnId; dir: string; files: string[]; instructionsBlob: ContentHash };
  LearningSnapshotPinned: { taskId: TaskId; snapshotHash: ContentHash; skillVersions: SkillVersionRef[] };
  LearnedProceduresSelected: { epochId: EpochId; skillVersions: SkillVersionRef[]; estTokens: number };

  /** Reproducibility pins (docs/specs/configuration.md#versioning-and-downgrade). */
  ModelRequest: {
    turnId: TurnId;
    epochId: EpochId;
    provider: string;
    adapterVersion: string;
    routeId: RouteId;
    accountScope?: string;
    profile: string; // "<id>@<version>"
    model: string;
    continuation: ContinuationMode;
    previousRef?: string;
    purpose: RequestPurpose;
    effort: { requested: EffortLevel; applied: AppliedEffort; native?: string };
    allowedTools?: string[];
    inputManifest: ContextManifest;
    inputBlob: ContentHash;
    promptHash: ContentHash;
    declarationsHash: ContentHash;
    capabilitySnapshotId: CapabilitySnapshotId;
    learningSnapshotHash?: ContentHash;
    generationConfig: Record<string, unknown>; // the allowlisted body as sent, minus input
  };
  ModelResponse: {
    turnId: TurnId;
    status: TurnStatus;
    steps: CanonicalStep[];
    providerRefs: { interactionId?: string; responseId?: string };
    usage: TurnUsage; // fields may be null
    replayItemsBlob?: ContentHash;
    latencyMs: number;
    ttftMs?: number;
  };
  CapabilitySnapshotRecorded: { snapshotId: CapabilitySnapshotId; snapshot: CapabilitySnapshot };
  ProviderSwitched: { taskId: TaskId; fromRoute: RouteId; toRoute: RouteId; fromModel: string; toModel: string; reason: string; confirmedPrivacyChange?: boolean };
  RouteStateChanged: { routeId: RouteId; from: RouteState["state"]; to: RouteState["state"]; reason: string };
  RouteConfigured: { routeId: RouteId; credentialRef?: CredentialRef; usageClass: UsageClass };
  CredentialRotated: { credentialRef: CredentialRef; version: number }; // never values
  AuthAttemptStarted: { attemptId: string };
  AuthAttemptFinished: { attemptId: string; result: string };
  ModelError: { turnId: TurnId; kind: string; retryable: boolean; attempt: number; message: string };
  ReasoningDecision: { turnId: TurnId; effort: EffortLevel; applied: AppliedEffort; native?: string; rule: string; inputsDigest: string };

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
  /** Durable intent before the first rename. */
  TransactionPrepared: { txnId: TransactionId; manifestBlob: ContentHash };
  TransactionRecovered: { txnId: TransactionId; outcome: RecoveryOutcome; paths: string[] };
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
    classification?: FailureClassification;
    artifactId?: ArtifactId;
    fingerprints: string[];
  };
  TaskVerdict: { taskId: TaskId; state: FinalTaskState; evidence: EvidenceBundle };
  IntegrityFinding: { taskId: TaskId; kind: string; severity: "block" | "flag" | "info"; path: string; justified: boolean };
  StuckDetected: { taskId: TaskId; rule: string; evidence: string };
  ReplanStarted: { taskId: TaskId; briefBlob: ContentHash };
  CriticCompleted: { taskId: TaskId; blocking: boolean; findingCount: number; dispositions: FindingDisposition[]; usage: TurnUsage };
  ReviewObligationOpened: { obligationId: string; taskId: TaskId; kind: "integrity" | "user_required_trigger"; source: string };
  ReviewObligationResolved: { obligationId: string; by: "critic" | "user"; outcome: string };

  // Projects and learning (workspace side; docs/specs/learning-service.md#events)
  ProjectCreated: { projectId: ProjectId; title: string };
  ProjectStateChanged: { projectId: ProjectId; from: string; to: string };
  /** Committed in the same transaction as LearningJobQueued. */
  ProjectFinalized: { projectId: ProjectId; generation: number; trigger: FinalizationTrigger; outcome: ProjectOutcome; packetBlob: ContentHash };
  LearningJobQueued: { jobId: LearningJobId; kind: "retrospective" };
  LearningJobDelivered: { jobId: LearningJobId };
  SkillFollowedObserved: { taskId: TaskId; skill: SkillVersionRef; signal: string };
  UserFeedbackRecorded: { projectId?: ProjectId; taskId?: TaskId; text: string };

  // Research (docs/specs/chrome-research.md#events)
  ResearchOpStarted: { opId: ResearchOpId; taskId: TaskId; tool: "web_search" | "web_open" | "web_find"; query?: string; url?: string };
  ResearchOpCompleted: { opId: ResearchOpId; outcome: ResearchOutcome; sourceIds: SourceId[]; ms: number; estTokens: number };
  SourceRecorded: { source: SourceRecord };
  CitationValidated: { sourceId: SourceId; range: LineRange; ok: boolean };
  ResearchBudgetExhausted: { taskId: TaskId; budget: string };
  ChromeStateChanged: { from: ChromeStatus["state"]; to: ChromeStatus["state"] };
  HumanHandoffRequested: { opId: ResearchOpId; kind: "consent_required" | "captcha" | "sign_in_wall" };
  HumanHandoffResolved: { opId: ResearchOpId; result: "resumed" | "abandoned" | "skipped" };
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
