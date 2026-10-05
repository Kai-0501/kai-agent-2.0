/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Context Compiler: budgeted epoch seeds + ingress admission + request preflight + epoch
 * decisions + route switches + complete manifests.
 * Spec: docs/specs/context-compiler.md · Decisions: docs/adr/0005, docs/adr/0018, docs/adr/0016.
 */
import type { ContentHash, EpochId, PlanItem, RouteId, TaskId, TaskState, ToolCallId, TurnId } from "@kai/protocol";
import type { SymbolCard } from "./codeintel.js";
import type { LearnedCard } from "./learning.js";
import type { HarnessProfileRef } from "./profiles.js";
import type { CanonicalStep, CapabilitySnapshot, ToolDeclaration } from "./provider.js";
import type { ToolOutcome } from "./tools.js";

export type EpochReason = "task_start" | "soft_limit" | "hard_limit" | "phase" | "replan" | "resume" | "model_switch";

export type ContextCategory =
  | "system"
  | "tools"
  | "project_instructions"
  | "learned_procedures"
  | "brief"
  | "repo_map"
  | "relevant_code"
  | "last_results"
  | "directive"
  | "tail_read"
  | "tail_search"
  | "tail_edit_result"
  | "tail_shell"
  | "tail_test"
  | "tail_artifact"
  | "tail_plan"
  | "tail_web"
  | "notices"
  | "user"
  // model-produced content occupying the context (chained or replayed):
  | "assistant_text"
  | "function_call_args"
  | "replay_native";

/** ESTIMATED tokens per category for the content a request adds; reconciled with REPORTED usage. */
export interface ContextManifest {
  readonly categories: Readonly<Partial<Record<ContextCategory, number>>>;
  /** ESTIMATED size of the whole request as sent (preflight input). */
  readonly estimatedRequestTokens: number;
  /** REPORTED after the response; null = the route did not report it (never 0 for unknown). */
  readonly reportedInputTokens?: number | null;
  readonly unattributed?: number | null;
}

/** Defaults in docs/specs/context-compiler.md#budget-model (calibrated by the benchmark). */
export interface ContextBudget {
  readonly seedTarget: number; // 24_000
  readonly reserveOutput: number; // 8_000
  readonly epochSoftLimit: number; // 64_000 (observed input tokens)
  readonly epochHardLimit: number; // 160_000
  readonly repoMapMin: number; // 2_000
  readonly repoMapMax: number; // 6_000
  readonly repoMapColdStart: number; // 8_000 (ledger empty for the task)
  readonly inlineToolResultMax: number; // 2_000
  readonly noticeMax: number; // 300
  /** Headroom for estimator error: max(512, 3% of window); unknown tokenizer max(1024, 8%). */
  readonly safetyMargin: number;
  /** Minimum prunable tail before a batched elision in local replay (20_000; scaled for small windows). */
  readonly elisionBatchTokens: number;
}

export type ContinuationMode = "provider_chain" | "local_replay";

export interface SeedInput {
  readonly taskId: TaskId;
  readonly epochId: EpochId;
  readonly reason: EpochReason;
  readonly budget: ContextBudget; // profile.contextSizing(snapshot, config)
  readonly snapshot: CapabilitySnapshot;
  readonly profile: HarnessProfileRef;
  readonly continuation: ContinuationMode;
  /** Pinned per task (LearningSnapshotPinned); identical for every epoch of the task. */
  readonly learning?: { readonly snapshotHash: ContentHash; readonly cards: readonly LearnedCard[] };
  readonly toolLoadout: readonly ToolDeclaration[]; // rendered by the profile
}

export interface CompiledSeed {
  readonly systemInstruction: string;
  readonly tools: readonly ToolDeclaration[];
  readonly input: readonly CanonicalStep[];
  readonly manifest: ContextManifest;
  readonly briefBlob: ContentHash;
}

export type NoticeType =
  | "stale_files"
  | "verification"
  | "late_diagnostics"
  | "budget"
  | "jit_instructions"
  | "epoch_soon"
  | "no_tool_call"
  | "deliberate" // escalation for models without effort control
  | "research_budget"
  | "citation"
  | "output_limit";

export type IngressItem =
  | { readonly kind: "tool_result"; readonly toolCallId: ToolCallId; readonly name: string; readonly outcome: ToolOutcome<unknown> }
  | { readonly kind: "notice"; readonly noticeType: NoticeType; readonly key: string; readonly text: string }
  | { readonly kind: "user"; readonly text: string };

export interface AdmittedItems {
  readonly steps: readonly CanonicalStep[];
  readonly manifestDelta: ContextManifest;
}

export interface EpochState {
  readonly epochId: EpochId;
  readonly taskId: TaskId;
  readonly startedAtTurn: number;
  /** null when the route does not report input tokens; epoch rules then use the estimate. */
  readonly lastReportedInputTokens: number | null;
  readonly lastEstimatedRequestTokens: number;
  readonly turnsSinceUpdatePlan: number;
  readonly continuation: ContinuationMode;
  readonly routeId: RouteId;
}

export interface EpochSignals {
  readonly replanRequested: boolean;
  readonly phaseChanged: boolean;
  readonly idleMs: number;
  readonly externalChangesToReadFiles: boolean;
  /** Provider, route, account, endpoint config or model switch pending (safe point only). */
  readonly modelSwitched: boolean;
}

export type PreflightAction = "reshape_results" | "batched_elision" | "new_epoch" | "drop_optional_seed_sections" | "blocked_context_exhausted";

export interface PreflightResult {
  readonly turnId: TurnId;
  readonly estimatedRequestTokens: number;
  readonly limit: number; // snapshot input limit − reserveOutput − safetyMargin
  readonly actions: readonly PreflightAction[];
  readonly fits: boolean; // false only with blocked_context_exhausted; such a request is never sent
}

export type EpochDecision = { readonly action: "continue" } | { readonly action: "new_epoch"; readonly reason: EpochReason };

export interface PendingRequest {
  readonly systemInstruction: string;
  readonly tools: readonly ToolDeclaration[];
  readonly input: readonly CanonicalStep[];
  readonly manifest: ContextManifest;
}

export interface ContextCompiler {
  compileSeed(input: SeedInput): Promise<CompiledSeed>;
  admit(items: readonly IngressItem[], epoch: EpochState): Promise<AdmittedItems>;
  /** Never returns an over-limit request (docs/specs/context-compiler.md#request-preflight). */
  preflight(request: PendingRequest, epoch: EpochState, snapshot: CapabilitySnapshot, budget: ContextBudget): Promise<{ readonly request: PendingRequest; readonly result: PreflightResult }>;
  epochDecision(state: EpochState, signals: EpochSignals): EpochDecision;
}

/** Deterministic brief built from projections (no LLM unless decisionDigest is needed). */
export interface EpochBrief {
  readonly objective: string; // user-owned (TaskCreated / TaskAmended)
  readonly acceptanceCriteria: readonly string[]; // user-owned; never model-edited
  readonly derivedCriteria: readonly string[]; // model-proposed, additive only
  readonly openReviewObligations: readonly string[];
  readonly constraints: readonly string[];
  readonly plan: readonly PlanItem[];
  readonly decisions: readonly { readonly decision: string; readonly rationale: string }[];
  readonly notes: readonly string[];
  readonly filesModified: readonly { readonly path: string; readonly diffStat: string; readonly intents: readonly string[] }[];
  readonly filesRead: readonly { readonly path: string; readonly hash: ContentHash; readonly symbols: readonly SymbolCard[]; readonly stale: boolean }[];
  readonly verification: { readonly lastVerdict?: TaskState; readonly checks: readonly { readonly id: string; readonly status: string }[] };
  readonly openFailures: readonly { readonly fp: string; readonly exact: string; readonly location?: string; readonly attempts: number }[];
  readonly attemptedApproaches: readonly { readonly attemptNo: number; readonly summary: string; readonly outcome: string }[];
  readonly nextAction: string;
  readonly decisionDigest?: string;
}

export interface TokenEstimator {
  estimate(text: string, category: ContextCategory): number;
  calibrate(observed: { readonly manifest: ContextManifest; readonly reportedInputTokens: number }): void;
}
