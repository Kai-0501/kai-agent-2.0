/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Learning Service port and records: project finalization, deterministic evidence packets,
 * bounded retrospectives, scoped versioned skills, deterministic retrieval with pinned snapshots.
 * Spec: docs/specs/learning-service.md · Decision: docs/adr/0022.
 *
 * Learning is advisory: it never changes permissions, verification requirements, integrity
 * policy, user objectives or runtime code (policy linter P1–P9).
 */
import type {
  ArtifactId,
  ContentHash,
  FinalTaskState,
  LearningJobId,
  ProfileId,
  ProjectId,
  ProjectOutcome,
  RetroId,
  RouteId,
  SkillId,
  SkillState,
  TaskId,
  WorkspaceId,
} from "@kai/protocol";
import type { ContextCategory } from "./context.js";
import type { RejectReason } from "./patch.js";
import type { FailureKind, StuckRule } from "./repair.js";
import type { ProjectResourceTotals } from "./telemetry.js";
import type { Tier } from "./verify.js";

export type FinalizationTrigger = "user_completed" | "user_cancelled" | "idle_rule";
export type PrivacyClass = "shareable" | "repo_private" | "local_only";
export type RepoFingerprint = string; // "rf_" + 8 hex

/** A reference the retrospective may read through read_evidence (resolved by the runtime). */
export type EvidenceRef =
  | `evt:${number}` // workspace event seq
  | `art_${string}` // artifact
  | `txn_${string}` // transaction diff
  | `ver_${string}` // verification run
  | `fp_${string}` // failure fingerprint
  | `src_${string}`; // research source (web provenance)

export interface SkillVersionRef {
  readonly skillId: SkillId;
  readonly version: number;
}

/** Deterministic, redacted, ≤ 24 KB (docs/specs/learning-service.md#1-evidence-packet-deterministic-no-model-call). */
export interface EvidencePacket {
  readonly packetVersion: 1;
  readonly project: {
    readonly projectId: ProjectId;
    readonly generation: number;
    readonly title: string;
    readonly trigger: FinalizationTrigger;
    readonly outcome: ProjectOutcome;
    readonly userFeedback?: string;
  };
  readonly repo: {
    readonly fingerprint: RepoFingerprint;
    readonly languages: readonly string[];
    readonly dependencies: readonly { readonly name: string; readonly version: string; readonly source: "lockfile" | "manifest" }[];
    readonly verificationProfileHash: ContentHash;
    readonly instructionsHash?: ContentHash;
  };
  readonly routes: readonly { readonly routeId: RouteId; readonly profileId: ProfileId; readonly model: string; readonly privacy: PrivacyClass }[];
  readonly tasks: readonly {
    readonly taskId: TaskId;
    readonly objectiveDigest: string;
    readonly finalState: FinalTaskState;
    readonly epochs: number;
    readonly turns: number;
    readonly replans: number;
    readonly repairAttempts: number;
    readonly stuckRules: readonly StuckRule[];
    readonly premature: number;
    readonly integrityIncidents: number;
    readonly criticBlocking: number;
    readonly integrityUnresolved: number;
    readonly introducedIntermittent: number;
  }[];
  readonly checks: readonly { readonly checkId: string; readonly tier: Tier; readonly runs: number; readonly failsIntroduced: number; readonly command: readonly string[]; readonly medianMs: number }[];
  readonly commands: readonly { readonly argvFingerprint: string; readonly argv0: string; readonly runs: number; readonly failures: number; readonly topFailure?: string; readonly artifactRefs: readonly ArtifactId[] }[];
  readonly repairFingerprints: readonly { readonly fp: string; readonly kind: FailureKind; readonly attempts: number; readonly resolved: boolean; readonly exact: string }[];
  readonly navigation: {
    readonly searchesBeforeFirstEdit: number;
    readonly readsStubbed: number;
    readonly wholeFileReads: number;
    readonly hotSymbols: readonly { readonly qualified: string; readonly path: string; readonly searchesBeforeFound: number }[];
  };
  readonly edits: { readonly txnApplied: number; readonly txnRejected: Readonly<Partial<Record<RejectReason, number>>>; readonly firewallBlocks: Readonly<Record<string, number>> };
  readonly context: { readonly meanSeedEstTokens: number; readonly categoryShares: Readonly<Partial<Record<ContextCategory, number>>>; readonly artifactReadbackRate: number; readonly preflightActions: Readonly<Record<string, number>> };
  readonly research: { readonly ops: number; readonly pagesOpened: number; readonly blocked: number; readonly citationsValidated: number };
  readonly resources: ProjectResourceTotals;
  readonly learning: { readonly snapshotHashes: readonly ContentHash[]; readonly skillsShown: readonly SkillVersionRef[]; readonly skillOutcomes: readonly { readonly ref: SkillVersionRef; readonly followed: "yes" | "no" | "unknown" }[] };
  readonly refs: readonly EvidenceRef[];
  readonly redaction: { readonly applied: boolean; readonly rules: readonly string[] };
}

export type SkillKind =
  | "navigation"
  | "commands"
  | "api_usage"
  | "verification_selection"
  | "repair_deadend"
  | "output_narrowing"
  | "reasoning_allocation"
  | "tooling"
  | "research";

export type SkillScopeLevel = "repo" | "stack" | "language" | "global";

export interface SkillScope {
  readonly level: SkillScopeLevel;
  readonly repo?: RepoFingerprint;
  readonly languages?: readonly string[];
  readonly dependencies?: readonly { readonly name: string; readonly range: string }[];
}

export type ModelScope = "any" | { readonly profile: ProfileId } | { readonly model: string };

export type SkillPrerequisite =
  | { readonly type: "path_exists"; readonly glob: string }
  | { readonly type: "symbol_exists"; readonly qualified: string }
  | { readonly type: "dependency_version"; readonly name: string; readonly range: string }
  | { readonly type: "tool_available"; readonly argv0: string }
  | { readonly type: "profile_check_exists"; readonly id: string }
  | { readonly type: "language"; readonly id: string };

/** Machine-checkable hints used to observe whether a shown skill was followed. */
export interface SkillSignals {
  readonly commands?: readonly string[];
  readonly paths?: readonly string[];
  readonly symbols?: readonly string[];
  readonly avoidCommands?: readonly string[];
}

export interface ProposedLesson {
  readonly kind: SkillKind;
  readonly title: string; // ≤ 80 chars
  readonly appliesWhen: readonly string[]; // ≤ 5
  readonly procedure: readonly string[]; // ≤ 8 steps
  readonly pitfalls?: readonly string[]; // ≤ 4
  readonly signals?: SkillSignals;
  readonly scopeSuggestion: SkillScopeLevel;
  readonly modelScope?: ModelScope;
  readonly evidenceRefs: readonly EvidenceRef[]; // ≥ 1, must resolve in the packet
  readonly expectedEffect: { readonly metric: "tokens" | "turns" | "repair_attempts" | "wall_ms" | "defects"; readonly direction: "down" };
  readonly mergeWith?: SkillId;
}

export type PolicyLintRule =
  | "P1_skip_required_checks"
  | "P2_weakens_required_checks"
  | "P3_integrity"
  | "P4_permissions"
  | "P5_objectives"
  | "P6_runtime"
  | "P7_review"
  | "P8_secrets_and_private"
  | "P9_unverifiable";

export type ProposalDisposition =
  | { readonly disposition: "accepted"; readonly skill: SkillVersionRef; readonly state: SkillState }
  | { readonly disposition: "rejected"; readonly rule: PolicyLintRule | "schema" | "size" | "evidence" | "provenance" }
  | { readonly disposition: "conflicted" };

export interface SkillVersion {
  readonly skillId: SkillId;
  readonly name: string;
  readonly version: number;
  readonly state: SkillState;
  readonly owner: "learned" | "user";
  readonly kind: SkillKind;
  readonly scope: SkillScope;
  readonly modelScope: ModelScope;
  readonly privacy: PrivacyClass;
  readonly prerequisites: readonly SkillPrerequisite[];
  readonly signals?: SkillSignals;
  readonly expires: { readonly unusedDays: number };
  readonly evidence: readonly string[]; // "ret_…#n" or EvidenceRef
  readonly contradictions: readonly { readonly projectId: ProjectId; readonly kind: string; readonly severity: "minor" | "harmful" }[];
  readonly provenance: { readonly createdBy: LearningJobId | "user"; readonly routeId?: RouteId; readonly profile?: string };
  readonly docHash: ContentHash; // hash of the rendered SKILL.md
  readonly validatedBy?: "observation" | "controlled_eval";
}

export interface LearningSnapshot {
  readonly hash: ContentHash; // pinned per task (LearningSnapshotPinned)
  readonly skills: readonly SkillVersionRef[];
}

/** What the Context Compiler renders inside <learned_procedures advisory="true">. */
export interface LearnedCard {
  readonly ref: SkillVersionRef;
  readonly provisional: boolean;
  readonly text: string; // ≤ cardMaxTokens
  readonly estTokens: number;
}

export interface RetrievalQuery {
  readonly objectiveTerms: readonly string[];
  readonly paths: readonly string[];
  readonly phase: "task_start" | "replan";
  readonly repo: RepoFingerprint;
  readonly languages: readonly string[];
  readonly dependencies: readonly { readonly name: string; readonly version: string }[];
  readonly profile: ProfileId;
  readonly model: string;
  readonly routePrivacy: "cloud" | "local_only";
  readonly maxCards: number; // 3
  readonly maxTokens: number; // 600
}

export type LearningJobState = "queued" | "running" | "completed" | "deferred" | "failed_permanent";
export type DeferReason = "no_permitted_route" | "quota_exhausted" | "route_signed_out" | "offline" | "budget_policy";

export interface LearningJob {
  readonly jobId: LearningJobId; // "lj_" + hex(sha256(projectId ‖ generation ‖ kind))[0..24]
  readonly kind: "retrospective";
  readonly projectId: ProjectId;
  readonly workspaceId: WorkspaceId;
  readonly generation: number;
  readonly state: LearningJobState;
  readonly reason?: DeferReason;
  readonly retryAfter?: string;
}

export interface RetrospectiveRecord {
  readonly retroId: RetroId;
  readonly jobId: LearningJobId;
  readonly packetHash: ContentHash;
  readonly routeId?: RouteId; // absent when only deterministic extractors ran
  readonly profile?: string;
  readonly model?: string;
  readonly summary: string;
  readonly proposals: readonly { readonly lesson: ProposedLesson; readonly source: "model" | "extractor"; readonly result: ProposalDisposition }[];
}

export interface LearningService {
  /** Workspace side: commit ProjectFinalized + LearningJobQueued in one transaction. Idempotent per generation. */
  finalize(projectId: ProjectId, outcome: ProjectOutcome, trigger: FinalizationTrigger, feedback?: string): Promise<LearningJobId>;
  /** Outbox delivery to the global store (at-least-once; idempotent by jobId). */
  deliverPending(signal: AbortSignal): Promise<number>;
  /** Claims and runs queued jobs with a lease. */
  runJobs(signal: AbortSignal): Promise<void>;
  snapshot(query: Pick<RetrievalQuery, "repo" | "profile" | "model" | "routePrivacy" | "languages" | "dependencies">): Promise<LearningSnapshot>;
  retrieve(snapshot: LearningSnapshot, query: RetrievalQuery): Promise<readonly LearnedCard[]>;
}
