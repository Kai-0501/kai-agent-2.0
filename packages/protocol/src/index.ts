/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Kai Session Protocol (KSP): the only contract between the Kai Runtime (which owns the
 * workspace) and clients. Spec: docs/specs/protocol.md · Decision: docs/adr/0002.
 *
 * Phase 1 replaces these hand-written types with Zod schemas (types inferred from them), so
 * runtime and clients validate every message.
 */

// ---------------------------------------------------------------------------------------------
// Identifiers (app-owned; provider IDs are stored only as references). See docs/specs/event-model.md
// ---------------------------------------------------------------------------------------------

declare const brand: unique symbol;
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type WorkspaceId = Brand<string, "WorkspaceId">; // "ws_" + 12 hex
export type SessionId = Brand<string, "SessionId">; // "ses_" + ULID
export type TaskId = Brand<string, "TaskId">; // "tsk_" + ULID
export type EpochId = Brand<string, "EpochId">; // "ep_" + ULID
export type TurnId = Brand<string, "TurnId">; // "trn_" + ULID
export type ToolCallId = Brand<string, "ToolCallId">; // "call_" + ULID
export type TransactionId = Brand<string, "TransactionId">; // "txn_" + ULID
export type ArtifactId = Brand<string, "ArtifactId">; // "art_" + 8 base32 (shown to the model)
export type CheckpointId = Brand<string, "CheckpointId">; // "chk_" + ULID
export type VerificationRunId = Brand<string, "VerificationRunId">; // "ver_" + ULID
export type PermissionRequestId = Brand<string, "PermissionRequestId">;
/** SHA-256 hex of raw bytes. */
export type ContentHash = Brand<string, "ContentHash">;

/** 1-based, inclusive line range (matches Gemini CLI's read_file). */
export interface LineRange {
  readonly start: number;
  readonly end: number;
}

// ---------------------------------------------------------------------------------------------
// Task state (docs/specs/verification-engine.md#task-state-machine)
// ---------------------------------------------------------------------------------------------

export type TaskState =
  | "open"
  | "in_progress"
  | "implemented_unverified"
  | "verifying"
  | "verification_failed"
  | "verified"
  | "blocked"
  | "cancelled";

/** States a task can end in. Only the Verification Engine can produce "verified". */
export type FinalTaskState = Extract<
  TaskState,
  "verified" | "verification_failed" | "implemented_unverified" | "blocked" | "cancelled"
>;

export type ReasoningEffort = "minimal" | "low" | "medium" | "high";

/** Why a task is blocked (blocked is a final state in headless runs). */
export type BlockedReason = "stuck" | "integrity_review_required" | "recovery_conflict" | "external_change" | "needs_user";

/**
 * Failure classes (docs/specs/verification-engine.md#lazy-baseline-classification). Only
 * `pre_existing`, `baseline_flaky` (established on the baseline) and `known_flaky` (user-approved)
 * do not block; a failure that appears only intermittently on the current tree is `introduced_intermittent`.
 */
export type FailureClassification = "introduced" | "introduced_intermittent" | "pre_existing" | "baseline_flaky" | "known_flaky";

export interface RunCounts {
  readonly passed: number;
  readonly failed: number;
}

// ---------------------------------------------------------------------------------------------
// Task Contract: user-owned requirements, verbatim and append-only (docs/specs/task-contract.md, ADR-0015)
// ---------------------------------------------------------------------------------------------

export interface ContractEntry {
  readonly id: string; // "c1", "c2", ... stable, used in citations
  readonly kind: "prompt" | "acceptance" | "steering" | "amendment" | "approval";
  /** VERBATIM user text: never summarized or rewritten. */
  readonly text: string;
  readonly by: "user";
  readonly source: { readonly protocolMethod: string; readonly seq: number };
  readonly supersedes?: readonly string[];
}

export interface TaskContractView {
  readonly taskId: TaskId;
  readonly version: number;
  readonly entries: readonly ContractEntry[];
  readonly instructionFiles: readonly { readonly path: string; readonly hash: ContentHash; readonly scopeDir: string }[];
  readonly hash: ContentHash;
}

// ---------------------------------------------------------------------------------------------
// JSON-RPC framing
// ---------------------------------------------------------------------------------------------

export interface RpcRequest<M extends KspMethod = KspMethod> {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly method: M;
  readonly params: KspMethods[M]["params"];
}

export interface RpcSuccess<M extends KspMethod = KspMethod> {
  readonly jsonrpc: "2.0";
  readonly id: number | string;
  readonly result: KspMethods[M]["result"];
}

export interface RpcFailure {
  readonly jsonrpc: "2.0";
  readonly id: number | string | null;
  readonly error: { readonly code: number; readonly message: string; readonly data?: KspErrorData };
}

export type KspErrorCode =
  | "WORKSPACE_LOCKED"
  | "SESSION_NOT_FOUND"
  | "TASK_NOT_ACTIVE"
  | "PERMISSION_EXPIRED"
  | "PROVIDER_UNAVAILABLE"
  | "CONFIG_INVALID";

export interface KspErrorData {
  readonly kaiCode?: KspErrorCode;
  readonly retryable: boolean;
}

// ---------------------------------------------------------------------------------------------
// Methods (client -> runtime)
// ---------------------------------------------------------------------------------------------

export interface RuntimeCapabilities {
  readonly stateModes: readonly ("chained" | "stateless")[];
  readonly languages: readonly string[]; // languages with index + LSP support
  readonly packs: readonly string[]; // available capability packs
  readonly transports: readonly ("in_memory" | "stdio" | "websocket")[];
}

export interface WorkspaceInfo {
  readonly workspaceId: WorkspaceId;
  readonly root: string;
  readonly vcs: "git" | "none";
  readonly languages: readonly string[];
  readonly profileStatus: "confirmed" | "discovered_unconfirmed" | "missing";
  readonly worktree?: { readonly path: string; readonly branch: string };
}

export interface SessionInfo {
  readonly sessionId: SessionId;
  readonly workspaceId: WorkspaceId;
  readonly model: string;
  readonly stateMode: "chained" | "stateless";
  readonly createdAt: string;
  readonly activeTaskId?: TaskId;
}

export interface KspMethods {
  initialize: {
    params: { clientName: string; clientVersion: string; protocolVersion: string; capabilities?: Record<string, unknown> };
    result: { protocolVersion: string; runtimeVersion: string; capabilities: RuntimeCapabilities };
  };
  "workspace.open": { params: { path: string; worktree?: boolean }; result: WorkspaceInfo };
  /** VerificationProfile is defined in @kai/core (docs/specs/verification-engine.md); opaque on the wire here. */
  "workspace.profile.get": { params: { workspaceId: WorkspaceId }; result: { profile: Record<string, unknown> | null } };
  "workspace.profile.set": { params: { workspaceId: WorkspaceId; profile: Record<string, unknown> }; result: Record<string, never> };
  "config.get": { params: { key: string }; result: { value: unknown } };
  "config.set": { params: { key: string; value: unknown; scope: "user" | "workspace" | "session" }; result: Record<string, never> };
  "session.create": {
    params: { workspaceId: WorkspaceId; model?: string; config?: Record<string, unknown> };
    result: SessionInfo;
  };
  "session.resume": { params: { sessionId: SessionId }; result: SessionInfo };
  "session.list": { params: { workspaceId: WorkspaceId }; result: { sessions: SessionInfo[] } };
  "session.close": { params: { sessionId: SessionId }; result: Record<string, never> };
  "session.subscribe": {
    params: { sessionId: SessionId; afterSeq?: number };
    result: { snapshot: SessionSnapshot; snapshotSeq: number };
  };
  /** Records the user-owned Task Contract v1. */
  "task.submit": { params: { sessionId: SessionId; prompt: string; acceptance?: string[] }; result: { taskId: TaskId } };
  /** User-only contract amendment (appended, never overwritten). */
  "task.amend": { params: { taskId: TaskId; text: string; supersedes?: string[] }; result: { contractVersion: number } };
  "task.steer": { params: { taskId: TaskId; message: string }; result: Record<string, never> };
  "task.cancel": { params: { taskId: TaskId }; result: Record<string, never> };
  "task.report": { params: { taskId: TaskId }; result: TaskReport };
  "permission.respond": {
    params: { requestId: PermissionRequestId; decision: "allow" | "deny"; remember?: "session" | "workspace" };
    result: Record<string, never>;
  };
  "checkpoint.list": { params: { sessionId: SessionId }; result: { checkpoints: CheckpointInfo[] } };
  "checkpoint.restore": { params: { checkpointId: CheckpointId; paths?: string[] }; result: { restoredPaths: string[] } };
  "artifact.read": { params: { artifactId: ArtifactId; range?: LineRange }; result: { text: string; totalLines: number } };
  /** Resolve a crash-recovery conflict (docs/specs/patch-engine.md#crash-recovery). */
  "recovery.resolve": {
    params: { txnId: TransactionId; choices: { path: string; choice: "keep_disk" | "restore_before" | "restore_after" }[] };
    result: Record<string, never>;
  };
  "stats.get": { params: { scope: "turn" | "task" | "session" | "workspace"; id: string }; result: Record<string, unknown> };
}

export type KspMethod = keyof KspMethods;

export interface CheckpointInfo {
  readonly checkpointId: CheckpointId;
  readonly gitRef: string; // refs/kai/checkpoints/<session>/<n>
  readonly reason: string;
  readonly createdAt: string;
}

// ---------------------------------------------------------------------------------------------
// Notifications (runtime -> client)
// ---------------------------------------------------------------------------------------------

/** Durable event as streamed to clients: same seq and type as the event log (filtered). */
export interface KspEventNotification {
  readonly method: "event";
  readonly params: {
    readonly seq: number;
    readonly sessionId: SessionId;
    readonly type: string; // see docs/specs/event-model.md#event-catalog-v1
    readonly ts: string;
    readonly payload: unknown;
  };
}

/** Ephemeral notifications: not persisted, no seq. */
export type KspEphemeralNotification =
  | { readonly method: "stream.delta"; readonly params: { turnId: TurnId; kind: "text" | "thought_summary" | "tool_args"; delta: string } }
  | { readonly method: "permission.request"; readonly params: PermissionRequest }
  | { readonly method: "progress"; readonly params: { operation: string; message: string; fraction?: number } };

export interface PermissionRequest {
  readonly requestId: PermissionRequestId;
  readonly kind: "command" | "path" | "network" | "integrity" | "verification_exception";
  readonly detail: string; // the command argv or path, rendered
  readonly risk: "low" | "medium" | "high";
  readonly reason: string;
}

// ---------------------------------------------------------------------------------------------
// Snapshots and reports
// ---------------------------------------------------------------------------------------------

export interface SessionSnapshot {
  readonly session: SessionInfo;
  readonly activeTask?: {
    readonly taskId: TaskId;
    readonly state: TaskState;
    readonly blockedReason?: BlockedReason;
    readonly contract: TaskContractView; // user-owned requirements
    readonly plan: readonly PlanItem[]; // model-authored working state (rendered as such)
  };
  readonly pendingRecoveryConflicts: readonly { readonly txnId: TransactionId; readonly paths: readonly string[] }[];
  readonly recentTurns: readonly { readonly turnId: TurnId; readonly summary: string }[];
  readonly openPermissionRequests: readonly PermissionRequest[];
  readonly lastVerdict?: { readonly taskId: TaskId; readonly state: FinalTaskState };
  readonly runningProcesses: readonly { readonly pid: number; readonly command: string; readonly artifactId: ArtifactId }[];
}

export interface PlanItem {
  readonly step: string;
  readonly status: "todo" | "doing" | "done" | "dropped";
}

export interface TaskReport {
  readonly taskId: TaskId;
  readonly state: TaskState;
  readonly blockedReason?: BlockedReason;
  /** What the task was graded against. */
  readonly contract: { readonly version: number; readonly hash: ContentHash };
  readonly evidence?: EvidenceSummary;
  readonly diffStat: { readonly files: number; readonly insertions: number; readonly deletions: number };
  /** Reported usage totals (from the API), plus estimated savings, always labelled. */
  readonly usage: {
    readonly reported: { input: number; cached: number; thought: number; output: number; total: number };
    /** ESTIMATED; only labelled calibrated while request accounting reconciles with reported usage. */
    readonly estimatedSavings: { ledger: number; spooling: number; calibrated: boolean };
    readonly costUsd: number;
    readonly priceTableVersion: string;
  };
}

/** Client-facing summary of the Verification Engine's EvidenceBundle. */
export interface EvidenceSummary {
  readonly checks: readonly {
    readonly id: string;
    readonly tier: "T2" | "T3" | "T4";
    readonly status: "pass" | "fail" | "skipped" | "error";
    readonly classification?: FailureClassification;
    readonly runs?: { readonly now: RunCounts; readonly baseline?: RunCounts };
    readonly artifactId?: ArtifactId;
    readonly summary: string;
  }[];
  readonly integrityFindings: number;
  readonly integrityUnresolved: number;
  readonly riskReview: "ran" | "skipped" | "not_triggered";
  readonly integrityReview: "ran" | "unavailable" | "not_required";
  readonly unverifiedReasons?: readonly string[];
}

export const PROTOCOL_VERSION = "0.1.0" as const;
