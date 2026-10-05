/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Kai Session Protocol (KSP): the only contract between the Kai Runtime (which owns the
 * workspace, credentials and the research browser) and clients (macOS app, CLI, benchmark).
 * Spec: docs/specs/protocol.md · Decisions: docs/adr/0002, docs/adr/0024.
 *
 * Credential-free rule: no response, notification or event type in this file carries secret
 * material. The only secret-bearing field is the inbound `credentials.put` params.secret.
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
export type ProjectId = Brand<string, "ProjectId">; // "prj_" + ULID
export type SourceId = Brand<string, "SourceId">; // "src_" + 8 base32 (shown to the model)
export type ResearchOpId = Brand<string, "ResearchOpId">; // "rop_" + ULID
export type CredentialRef = Brand<string, "CredentialRef">; // "cred_" + 16 base32; opaque, safe to log
export type AccountKey = Brand<string, "AccountKey">; // "acct_" + 16 hex of sha256(sub ‖ workspace?)
export type SkillId = Brand<string, "SkillId">; // "skl_" + ULID
export type RetroId = Brand<string, "RetroId">; // "ret_" + ULID
export type LearningJobId = Brand<string, "LearningJobId">; // "lj_" + 24 hex, derived (idempotent)
export type CapabilitySnapshotId = Brand<string, "CapabilitySnapshotId">; // "cap_" + 16 hex
/** User slug for a compatible endpoint: ^[a-z0-9][a-z0-9-]{0,39}$ */
export type EndpointId = Brand<string, "EndpointId">;
/** Credential routes (docs/specs/credentials.md). */
export type RouteId = "gemini.api_key" | "openai.api_key" | "openai.chatgpt_subscription" | `compat:${string}` | "fake";
export type ProfileId = "gemini" | "openai" | "generic";
export type UsageClass = "api_metered" | "subscription_allowance" | "local_compute" | "none";
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

/**
 * Canonical effort scale (ordinal). Not a universal provider enum: profiles map an intent to
 * each model's native levels from its capability snapshot (docs/adr/0018).
 */
export type EffortLevel = "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
/** Founding name kept as an alias. */
export type ReasoningEffort = EffortLevel;
export type AppliedEffort = EffortLevel | "uncontrolled";

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
  | "CONFIG_INVALID"
  | "ROUTE_UNAVAILABLE"
  | "PROJECT_BUSY"
  | "ENDPOINT_CHAT_ONLY"
  | "RESEARCH_UNAVAILABLE"
  | "OFFLINE_MODE"
  | "STORE_READ_ONLY";

export interface KspErrorData {
  readonly kaiCode?: KspErrorCode;
  readonly retryable: boolean;
}

// ---------------------------------------------------------------------------------------------
// Methods (client -> runtime)
// ---------------------------------------------------------------------------------------------

export type RuntimeFeature = "routes" | "projects" | "learning" | "research" | "endpoints" | "chatgptAuth";

export interface RuntimeCapabilities {
  readonly stateModes: readonly ("chained" | "stateless")[];
  readonly languages: readonly string[]; // languages with index + LSP support
  readonly packs: readonly string[]; // available capability packs
  readonly transports: readonly ("in_memory" | "stdio" | "message_port" | "websocket")[];
  /** Capabilities, not versions, gate optional features; clients hide what is absent. */
  readonly features: readonly RuntimeFeature[];
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
  readonly projectId: ProjectId;
  readonly routeId: RouteId;
  readonly accountKey?: AccountKey;
  readonly profile: string; // "<ProfileId>@<semver>"
  readonly model: string;
  readonly continuation: "provider_chain" | "local_replay";
  readonly createdAt: string;
  readonly activeTaskId?: TaskId;
}

// ---------------------------------------------------------------------------------------------
// Client-visible route, research, project and learning state (docs/specs/credentials.md,
// chrome-research.md, learning-service.md). None of these carries secret material.
// ---------------------------------------------------------------------------------------------

export type RouteState =
  | { readonly state: "not_configured" }
  | { readonly state: "authorizing"; readonly attemptId: string }
  | { readonly state: "ready"; readonly accountLabel?: string; readonly expiresAt?: string }
  | { readonly state: "refreshing" }
  | { readonly state: "reauth_required"; readonly reason: "refresh_rejected" | "revoked" | "scope_missing" | "account_changed" }
  | { readonly state: "plan_permission_missing" }
  | { readonly state: "quota_exhausted"; readonly detail: string; readonly since: string } // never a fabricated reset time
  | { readonly state: "usage_unavailable"; readonly since: string }
  | { readonly state: "signing_out" }
  | { readonly state: "signed_out"; readonly revocation: "confirmed" | "unconfirmed" | "not_applicable" }
  | { readonly state: "disabled"; readonly reason: "distribution_ineligible" | "offline_mode" | "store_unavailable" | "policy" };

export interface RouteSummary {
  readonly routeId: RouteId;
  readonly usageClass: UsageClass;
  readonly defaultProfile: ProfileId;
  readonly state: RouteState;
  readonly accounts?: readonly { readonly accountKey: AccountKey; readonly label: string; readonly workspaceLabel?: string; readonly selected: boolean }[];
}

export interface ModelCatalogEntry {
  readonly slug: string; // sent as `model`
  readonly displayName: string;
  readonly source: "catalog" | "config" | "model_facts";
}

export type ChromeStatus =
  | { readonly state: "not_installed" }
  | { readonly state: "chrome_invalid"; readonly reason: "not_chrome" | "missing_executable" | "signature" }
  | { readonly state: "chrome_unsupported_version"; readonly found: string; readonly minimum: string }
  | { readonly state: "disabled"; readonly reason: "research_off" | "offline_mode" | "workspace_policy" }
  | { readonly state: "permission_needed" }
  | { readonly state: "ready"; readonly version: string; readonly path: string }
  | { readonly state: "starting" }
  | { readonly state: "running"; readonly pages: number }
  | { readonly state: "profile_locked"; readonly holderPid?: number }
  | { readonly state: "crashed"; readonly restartsInWindow: number }
  | { readonly state: "unstable"; readonly until: string };

export type ProjectOutcome = "completed" | "partially_completed" | "failed" | "cancelled" | "inferred";

export interface ProjectInfo {
  readonly projectId: ProjectId;
  readonly workspaceId: WorkspaceId;
  readonly title: string;
  readonly state: "active" | "finalizing" | "finalized";
  readonly generation: number;
  readonly outcome?: ProjectOutcome;
  readonly reflection?: "none" | "pending" | "deferred" | "completed" | "failed";
}

export type SkillState = "candidate" | "provisional" | "validated" | "retired";

export interface SkillSummary {
  readonly skillId: SkillId;
  readonly name: string;
  readonly version: number;
  readonly state: SkillState;
  readonly owner: "learned" | "user";
  readonly kind: string;
  readonly scope: "repo" | "stack" | "language" | "global";
  readonly privacy: "shareable" | "repo_private" | "local_only";
  readonly disabled: boolean;
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
    params: { workspaceId: WorkspaceId; projectId?: ProjectId; routeId?: RouteId; model?: string; accountKey?: AccountKey; config?: Record<string, unknown> };
    result: SessionInfo;
  };
  "session.resume": { params: { sessionId: SessionId }; result: SessionInfo };
  "session.list": { params: { workspaceId: WorkspaceId }; result: { sessions: SessionInfo[] } };
  "session.close": { params: { sessionId: SessionId }; result: Record<string, never> };
  "session.subscribe": {
    params: { sessionId: SessionId; afterSeq?: number };
    result: { snapshot: SessionSnapshot; snapshotSeq: number };
  };
  "task.submit": { params: { sessionId: SessionId; prompt: string; acceptance?: string[] }; result: { taskId: TaskId } };
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
  "stats.get": { params: { scope: "turn" | "task" | "session" | "workspace" | "project"; id: string }; result: Record<string, unknown> };

  // --- Release extension (docs/specs/protocol.md#methods-v1) ---
  /** User-only change of the user-owned objective or acceptance criteria (docs/adr/0016). */
  "task.amend": { params: { taskId: TaskId; objective?: string; acceptance?: string[] }; result: Record<string, never> };
  "task.resume": { params: { taskId: TaskId; routeId?: RouteId; model?: string }; result: Record<string, never> };
  "task.switchRoute": {
    params: { taskId: TaskId; routeId: RouteId; model: string; accountKey?: AccountKey; confirmPrivacyChange?: boolean };
    result: Record<string, never>;
  };
  "project.create": { params: { workspaceId: WorkspaceId; title: string }; result: ProjectInfo };
  "project.list": { params: { workspaceId: WorkspaceId }; result: { projects: ProjectInfo[] } };
  "project.finalize": { params: { projectId: ProjectId; outcome: Exclude<ProjectOutcome, "inferred">; feedback?: string }; result: ProjectInfo };
  "project.reopen": { params: { projectId: ProjectId }; result: ProjectInfo };
  "provider.routes": { params: Record<string, never>; result: { routes: RouteSummary[] } };
  "provider.models": { params: { routeId: RouteId; accountKey?: AccountKey }; result: { models: ModelCatalogEntry[] } };
  /** Returns the snapshot as JSON (CapabilitySnapshot is defined in @kai/core). Billable probes ask first. */
  "provider.probe": { params: { routeId: RouteId; model: string }; result: { snapshot: Record<string, unknown> } };
  /** The ONLY secret-bearing request. Transports mark `secret` non-loggable; never echoed. */
  "credentials.put": { params: { routeId: RouteId; secret: string }; result: { credentialRef: CredentialRef } };
  "credentials.delete": { params: { credentialRef: CredentialRef }; result: Record<string, never> };
  "credentials.list": { params: Record<string, never>; result: { credentials: { credentialRef: CredentialRef; routeId: RouteId; kind: string; label?: string }[] } };
  "auth.chatgpt.begin": { params: { accountKey?: AccountKey }; result: { attemptId: string; authorizeUrl: string } };
  "auth.chatgpt.cancel": { params: { attemptId: string }; result: Record<string, never> };
  "auth.chatgpt.status": { params: Record<string, never>; result: RouteSummary };
  "auth.chatgpt.signOut": { params: { accountKey: AccountKey }; result: { revocation: "confirmed" | "unconfirmed" } };
  "auth.chatgpt.select": { params: { sessionId: SessionId; accountKey: AccountKey }; result: Record<string, never> };
  /** Endpoint config is validated by the runtime; inline secrets are rejected. */
  "endpoint.upsert": { params: { endpointId: EndpointId; config: Record<string, unknown> }; result: { config: Record<string, unknown> } };
  "endpoint.remove": { params: { endpointId: EndpointId }; result: Record<string, never> };
  "endpoint.doctor": { params: { endpointId: EndpointId; reprobe?: boolean }; result: EndpointDoctorReport };
  "learning.status": { params: Record<string, never>; result: { enabled: boolean; retrieval: boolean; reflection: boolean; pending: number } };
  "learning.list": { params: { state?: SkillState; scope?: SkillSummary["scope"] }; result: { skills: SkillSummary[] } };
  "learning.get": { params: { skillId: SkillId } | { retroId: RetroId }; result: { markdown: string; record: Record<string, unknown> } };
  "learning.setEnabled": { params: { skillId?: SkillId; enabled: boolean }; result: Record<string, never> };
  "learning.retire": { params: { skillId: SkillId; reason?: string }; result: SkillSummary };
  "learning.restore": { params: { skillId: SkillId }; result: SkillSummary };
  "learning.rollback": { params: { skillId: SkillId; toVersion: number }; result: SkillSummary };
  "learning.delete": { params: { skillId: SkillId }; result: Record<string, never> };
  "learning.export": { params: { format: "zip" }; result: { path: string } };
  "learning.reset": { params: { scope: "all" | "skills" | "retrospectives" }; result: Record<string, never> };
  "learning.reflectNow": { params: { projectId: ProjectId }; result: { jobId: LearningJobId } };
  "research.status": { params: Record<string, never>; result: { chrome: ChromeStatus; mode: "off" | "ask_first_use" | "enabled"; offline: boolean } };
  "research.setMode": { params: { mode: "off" | "enabled" }; result: { chrome: ChromeStatus } };
  "research.setChromePath": { params: { path: string | null }; result: { chrome: ChromeStatus } };
  "research.resetProfile": { params: Record<string, never>; result: { chrome: ChromeStatus } };
  "research.handoff.open": { params: { opId: ResearchOpId }; result: Record<string, never> };
  "research.handoff.skip": { params: { opId: ResearchOpId }; result: Record<string, never> };
  /** SourceRecord is defined in @kai/core (docs/specs/chrome-research.md); opaque here. */
  "research.source.get": { params: { sourceId: SourceId }; result: { source: Record<string, unknown>; excerpt?: string } };
  "runtime.shutdown": { params: { deadlineMs: number }; result: Record<string, never> };
}

export interface EndpointDoctorReport {
  readonly endpointId: EndpointId;
  readonly normalizedUrl: string;
  readonly scopeCheck: { readonly declared: "public" | "loopback" | "lan"; readonly resolvedClass: string; readonly ok: boolean };
  readonly authKind: "bearer" | "header" | "none"; // never the secret
  readonly probes: readonly { readonly id: string; readonly result: "supported" | "unsupported" | "unknown" | "error"; readonly ms?: number; readonly note?: string }[];
  readonly limits: { readonly contextTokens: number; readonly maxOutputTokens: number; readonly source: "declared" | "metadata" | "probe" | "default_conservative" };
  readonly mode: "agent" | "chat_only";
  readonly reasons: readonly string[];
  readonly overrides: readonly string[];
  readonly snapshotAge?: string;
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
  | { readonly method: "progress"; readonly params: { operation: string; message: string; fraction?: number } }
  /** Main process opens allowlisted URLs (OAuth authorization) in the default browser. */
  | { readonly method: "open.external"; readonly params: { url: string; purpose: "chatgpt_sign_in" | "chatgpt_usage" | "chrome_download" | "citation" } };

export interface PermissionRequest {
  readonly requestId: PermissionRequestId;
  readonly kind: "command" | "path" | "network" | "integrity" | "research" | "probe" | "privacy_change";
  readonly detail: string; // the command argv or path, rendered
  readonly risk: "low" | "medium" | "high";
  readonly reason: string;
}

// ---------------------------------------------------------------------------------------------
// Snapshots and reports
// ---------------------------------------------------------------------------------------------

export interface SessionSnapshot {
  readonly session: SessionInfo;
  readonly activeTask?: { readonly taskId: TaskId; readonly state: TaskState; readonly objective: string; readonly plan: readonly PlanItem[] };
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
  readonly evidence?: EvidenceSummary;
  readonly diffStat: { readonly files: number; readonly insertions: number; readonly deletions: number };
  /** Reported usage totals (from the API; null = not reported), estimated savings, always labelled. */
  readonly usage: {
    readonly usageClass: UsageClass;
    readonly reported: { input: number | null; cached: number | null; reasoning: number | null; output: number | null; total: number | null };
    readonly unreportedTurns: number;
    readonly estimatedSavings: { ledger: number; spooling: number };
    readonly costUsd: number | null; // api_metered with a price table only; never 0 for plan usage
    readonly priceTableVersion?: string;
  };
}

/** Client-facing summary of the Verification Engine's EvidenceBundle. */
export interface EvidenceSummary {
  readonly checks: readonly {
    readonly id: string;
    readonly tier: "T2" | "T3" | "T4";
    readonly status: "pass" | "fail" | "skipped" | "error";
    readonly classification?: "introduced" | "introduced_intermittent" | "pre_existing" | "flaky";
    readonly artifactId?: ArtifactId;
    readonly summary: string;
  }[];
  readonly integrityFindings: number;
  readonly openReviewObligations: number;
  readonly criticRan: boolean;
  readonly acceptance: { readonly user: readonly string[]; readonly derived: readonly string[] };
  readonly unverifiedReasons?: readonly string[];
}

export const PROTOCOL_VERSION = "0.2.0" as const;
