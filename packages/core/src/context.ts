/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Context Compiler: budgeted epoch seeds + ingress admission + epoch decisions + manifests.
 * Spec: docs/specs/context-compiler.md · Decision: docs/adr/0005.
 */
import type { ContentHash, EpochId, PlanItem, TaskId, TaskState, ToolCallId } from "@kai/protocol";
import type { SymbolCard } from "./codeintel.js";
import type { CanonicalStep, ModelCapabilities, ToolDeclaration } from "./provider.js";
import type { ToolOutcome } from "./tools.js";

export type EpochReason = "task_start" | "soft_limit" | "hard_limit" | "phase" | "replan" | "resume" | "model_switch";

export type ContextCategory =
  | "system"
  | "tools"
  | "project_instructions"
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
  | "notices"
  | "user";

/** ESTIMATED tokens per category for the content a request adds; reconciled with REPORTED usage. */
export interface ContextManifest {
  readonly categories: Readonly<Partial<Record<ContextCategory, number>>>;
  readonly reportedInputTokens?: number;
  readonly unattributed?: number;
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
}

export interface SeedInput {
  readonly taskId: TaskId;
  readonly epochId: EpochId;
  readonly reason: EpochReason;
  readonly budget: ContextBudget;
  readonly providerCaps: ModelCapabilities;
  readonly toolLoadout: readonly ToolDeclaration[];
}

export interface CompiledSeed {
  readonly systemInstruction: string;
  readonly tools: readonly ToolDeclaration[];
  readonly input: readonly CanonicalStep[];
  readonly manifest: ContextManifest;
  readonly briefBlob: ContentHash;
}

export type NoticeType = "stale_files" | "verification" | "late_diagnostics" | "budget" | "jit_instructions" | "epoch_soon" | "no_tool_call";

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
  readonly lastReportedInputTokens: number;
  readonly turnsSinceUpdatePlan: number;
  readonly stateMode: "chained" | "stateless";
}

export interface EpochSignals {
  readonly replanRequested: boolean;
  readonly phaseChanged: boolean;
  readonly idleMs: number;
  readonly externalChangesToReadFiles: boolean;
  readonly modelSwitched: boolean;
}

export type EpochDecision = { readonly action: "continue" } | { readonly action: "new_epoch"; readonly reason: EpochReason };

export interface ContextCompiler {
  compileSeed(input: SeedInput): Promise<CompiledSeed>;
  admit(items: readonly IngressItem[], epoch: EpochState): Promise<AdmittedItems>;
  epochDecision(state: EpochState, signals: EpochSignals): EpochDecision;
}

/** Deterministic brief built from projections (no LLM unless decisionDigest is needed). */
export interface EpochBrief {
  readonly objective: string;
  readonly acceptanceCriteria: readonly string[];
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
