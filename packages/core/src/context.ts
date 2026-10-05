/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Context Compiler: budgeted epoch seeds, ingress admission, REQUEST PREFLIGHT, epoch decisions,
 * instruction map, and COMPLETE request accounting (including model-generated history).
 * Spec: docs/specs/context-compiler.md · Decisions: docs/adr/0005, amended by docs/adr/0016; docs/adr/0015.
 */
import type { ContentHash, EpochId, PlanItem, TaskId, TaskState, ToolCallId } from "@kai/protocol";
import type { SymbolCard } from "./codeintel.js";
import type { TaskContract } from "./contract.js";
import type { CanonicalStep, ModelCapabilities, ToolDeclaration } from "./provider.js";
import type { ToolOutcome } from "./tools.js";

export type EpochReason = "task_start" | "soft_limit" | "hard_limit" | "phase" | "replan" | "resume" | "model_switch";

/** Every input token of a request belongs to exactly one category. */
export type ContextCategory =
  // prefix
  | "system"
  | "tools"
  // seed
  | "project_instructions"
  | "task_contract"
  | "brief"
  | "repo_map"
  | "relevant_code"
  | "last_results"
  | "directive"
  // ingress
  | "tail_read"
  | "tail_search"
  | "tail_edit_result"
  | "tail_shell"
  | "tail_test"
  | "tail_artifact"
  | "tail_plan"
  | "jit_instructions"
  | "notices"
  | "user"
  // model-generated history (sized from REPORTED output/thought tokens)
  | "history_model_text"
  | "history_function_calls"
  | "history_thoughts"
  // overhead
  | "framing";

export interface CategoryCount {
  readonly tokens: number;
  readonly source: "reported" | "estimated";
}

/** Complete request accounting: delta (new since the previous request) + composition (everything sent). */
export interface ContextManifest {
  readonly delta: Readonly<Partial<Record<ContextCategory, CategoryCount>>>;
  readonly composition: Readonly<Partial<Record<ContextCategory, CategoryCount>>>;
  readonly reportedInputTokens?: number; // filled in after the response
  readonly residual?: number; // reported − Σ composition
}

/** Defaults in docs/specs/context-compiler.md#budget-model (calibrated by the benchmark). */
export interface ContextBudget {
  readonly seedTarget: number; // 24_000
  readonly reserveOutput: number; // 8_000
  readonly epochSoftLimit: number; // 64_000 (projected input)
  readonly epochHardLimit: number; // 160_000 — no request is ever sent above this
  readonly ingressBatchMax: number; // 12_000 total shaped ingress per request
  readonly preflightMarginMin: number; // 0.10 (fraction of pending ingress)
  readonly contractMaxTokens: number; // 3_000 (prompt/acceptance entries never cut)
  readonly instructionsMax: number; // 6_000
  readonly repoMapMin: number; // 2_000
  readonly repoMapMax: number; // 6_000
  readonly repoMapColdStart: number; // 8_000 (ledger empty for the task)
  readonly inlineToolResultMax: number; // 2_000 per item
  readonly noticeMax: number; // 300 (instruction deliveries exempt)
}

export interface SeedInput {
  readonly taskId: TaskId;
  readonly epochId: EpochId;
  readonly reason: EpochReason;
  readonly budget: ContextBudget;
  readonly providerCaps: ModelCapabilities;
  readonly toolLoadout: readonly ToolDeclaration[];
  /** Pending results carried into <last_results> when rolling over mid-batch. */
  readonly carriedResults?: AdmittedItems;
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
  | "recovery";

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
  readonly rolloverScheduled: boolean; // set by a "send_then_rollover" preflight
}

export interface EpochSignals {
  readonly replanRequested: boolean;
  readonly phaseChanged: boolean;
  readonly idleMs: number;
  readonly externalChangesToReadFiles: boolean;
  readonly modelSwitched: boolean;
  readonly recoveryRan: boolean;
}

export type EpochDecision = { readonly action: "continue" } | { readonly action: "new_epoch"; readonly reason: EpochReason };

export interface PreflightInput {
  readonly epoch: EpochState;
  readonly pending: AdmittedItems;
  /** REPORTED usage of the previous response: its output (and possibly thoughts) becomes history. */
  readonly lastResponse?: { readonly outputTokens: number; readonly thoughtTokens: number };
  readonly budget: ContextBudget;
  readonly stateMode: "chained" | "stateless";
  /** inputTokenLimit gives emergencyLimit; the G10 flags decide whether prior output/thoughts are carried. */
  readonly caps: Pick<ModelCapabilities, "inputTokenLimit" | "chainedInputIncludesPriorOutput" | "chainedInputIncludesPriorThoughts">;
}

export interface PreflightResult {
  /** ESTIMATED projection of the complete next request. */
  readonly projectedInputTokens: number;
  readonly breakdown: {
    readonly priorInput: number;
    readonly carriedOutput: number;
    readonly carriedThoughts: number;
    readonly pendingIngress: number;
    readonly framing: number;
    readonly margin: number;
  };
  readonly action: "send" | "send_then_rollover" | "reshape" | "rollover_now";
  readonly reshaped?: AdmittedItems;
}

export interface InstructionFileRef {
  readonly path: string;
  readonly scopeDir: string;
  readonly hash: ContentHash;
  readonly estTokens: number;
}

export interface ContextCompiler {
  compileSeed(input: SeedInput): Promise<CompiledSeed>;
  admit(items: readonly IngressItem[], epoch: EpochState): Promise<AdmittedItems>;
  /** Runs before EVERY request; never lets a request above epochHardLimit (or emergencyLimit) be sent. */
  preflight(input: PreflightInput): PreflightResult;
  epochDecision(state: EpochState, signals: EpochSignals): EpochDecision;
  /** Instruction files applicable to a path, root → leaf (from the instruction map). */
  applicableInstructions(path: string): readonly InstructionFileRef[];
}

/** Deterministic brief built from projections. User-owned and model-authored parts are separate. */
export interface EpochBrief {
  /** USER-OWNED, verbatim (rendered as <task_contract>). */
  readonly contract: Pick<TaskContract, "version" | "entries">;
  /** MODEL-AUTHORED (rendered as <working_state author="model">); never authoritative. */
  readonly workingState: {
    readonly plan: readonly PlanItem[];
    readonly decisions: readonly { readonly decision: string; readonly rationale: string }[];
    readonly notes: readonly string[];
    readonly interpretations: readonly string[];
    readonly proposedCriteria: readonly string[];
  };
  readonly filesModified: readonly { readonly path: string; readonly diffStat: string; readonly intents: readonly string[] }[];
  readonly filesRead: readonly { readonly path: string; readonly hash: ContentHash; readonly symbols: readonly SymbolCard[]; readonly stale: boolean }[];
  readonly verification: { readonly lastVerdict?: TaskState; readonly checks: readonly { readonly id: string; readonly status: string }[] };
  readonly openFailures: readonly { readonly fp: string; readonly exact: string; readonly location?: string; readonly attempts: number }[];
  readonly attemptedApproaches: readonly { readonly attemptNo: number; readonly summary: string; readonly outcome: string }[];
  readonly recoveryNotes?: readonly string[];
  readonly nextAction: string;
  readonly decisionDigest?: string; // LLM-generated, model-authored
}

export interface TokenEstimator {
  estimate(text: string, category: ContextCategory): number;
  /** Calibrate ONLY on measured ingress (chained accounting identity) or seed turns — never on model-generated history. */
  calibrate(sample: {
    readonly kind: "seed" | "ingress";
    readonly estimated: Readonly<Partial<Record<ContextCategory, number>>>;
    readonly measured: number;
  }): void;
}
