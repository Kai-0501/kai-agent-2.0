/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Harness profile port: model-facing behaviour on the shared trusted runtime (prompts, tool
 * rendering, effort mapping, replay, context sizing, review and stop policy). Implementations
 * (gemini, openai, generic) live in the planned `profiles` package; core never branches on their
 * ids. A profile can never relax what is accepted (docs/specs/harness-profiles.md).
 * Decisions: docs/adr/0016, docs/adr/0018, docs/adr/0019.
 */
import type { ContentHash, EffortLevel, ProfileId } from "@kai/protocol";
import type { ContextBudget } from "./context.js";
import type { RequestPurpose, RiskAssessment } from "./governor.js";
import type { CapabilitySnapshot, EffortRecord, ToolDeclaration } from "./provider.js";

export type ProfileFit = { readonly ok: true } | { readonly ok: false; readonly reasons: readonly string[] };

export interface PromptContext {
  readonly packs: readonly string[];
  readonly researchActive: boolean;
  readonly learningActive: boolean;
  readonly snapshot: CapabilitySnapshot;
}

export interface PromptRender {
  readonly text: string;
  readonly hash: ContentHash;
  readonly estTokens: number;
  /** The 12 shared contract items, checked by CI (docs/specs/harness-profiles.md#shared-prompt-contract). */
  readonly contractItems: readonly string[];
}

/** Registry view of a tool as the profile needs it to render (schema stays the registry's). */
export interface ToolDefinitionView {
  readonly name: string;
  readonly pack: string;
  readonly description: string;
  readonly parametersJsonSchema: Readonly<Record<string, unknown>>;
  readonly mutating: boolean;
  readonly readOnlyParallelSafe: boolean;
}

export interface ToolRendering {
  readonly declarations: readonly ToolDeclaration[];
  /** rendered name → registry name; resolved before validation and authorization. */
  readonly aliases: Readonly<Record<string, string>>;
  readonly schemaDialect: "full" | "strict_compatible" | "simple";
  readonly parallel: "allowed" | "read_only" | "disabled";
  readonly estTokens: number;
}

export interface EffortRuleModifier {
  readonly rule: string; // "R2", "R4", "R8", …
  readonly when?: { readonly riskReasonsAny?: readonly string[]; readonly purpose?: RequestPurpose };
  readonly raiseTo: EffortLevel; // modifiers only raise (risk floors are never lowered)
}

export interface EffortPolicy {
  readonly modifiers: readonly EffortRuleModifier[];
  /** Nearest native level; ties up for replan, critic and high risk, otherwise down. */
  map(intent: EffortLevel, purpose: RequestPurpose, risk: RiskAssessment, snapshot: CapabilitySnapshot): EffortRecord;
  /** De-escalate only after N consecutive lower results when effort changes are not cache-safe. */
  readonly hysteresisTurns: number; // 2
  /** No effort control: escalate with a deliberation notice instead. */
  readonly deliberationNotice: boolean;
}

export interface ContextTooSmall {
  readonly tooSmall: true;
  readonly usableTokens: number;
  readonly minimum: number; // 10_000
}

export interface ReplayPolicy {
  /** Replay compatible reasoning_content only if the endpoint requires it (probe P8). */
  readonly replayReasoningWhen: "always" | "if_required" | "never";
  readonly elisionBatchTokens: (usableTokens: number) => number;
}

export interface ReviewPolicy {
  readonly optionalRoundsAfterBlockingFix: number; // gemini 2, openai 1, generic 1 (if structured review)
  readonly advisoryListedMax: number; // gemini 10, openai 5, generic 5
  /** Categories in which a validated argument may block without a reproduction. */
  readonly exemptCategories: readonly ("security" | "concurrency" | "api_contract" | "integrity")[];
  readonly requireStructuredReview: boolean;
}

export interface StopPolicy {
  readonly stopLine: string; // rendered into the prompt
  readonly reopenOn: readonly ("failing_check" | "reproduced_defect" | "changed_requirement" | "security" | "concurrency" | "api_contract" | "integrity")[];
}

export interface ReflectionContext {
  readonly packetEstTokens: number;
  readonly existingSkillSummaries: readonly string[];
  readonly maxEvidenceReads: number;
}

export interface HarnessProfile {
  readonly id: ProfileId;
  readonly version: string; // semver; pinned in ModelRequest events
  appliesTo(snapshot: CapabilitySnapshot): ProfileFit;
  systemPrompt(ctx: PromptContext): PromptRender;
  renderTools(tools: readonly ToolDefinitionView[], snapshot: CapabilitySnapshot): ToolRendering;
  noticeRole(snapshot: CapabilitySnapshot): "user" | "developer";
  readonly effortPolicy: EffortPolicy;
  /** Derives the budget from the snapshot (docs/specs/harness-profiles.md#context-sizing). */
  contextSizing(snapshot: CapabilitySnapshot, base: ContextBudget): ContextBudget | ContextTooSmall;
  readonly replayPolicy: ReplayPolicy;
  readonly reviewPolicy: ReviewPolicy;
  readonly stopPolicy: StopPolicy;
  reflectionPrompt(ctx: ReflectionContext): PromptRender;
}

/** Reference recorded in events and requests. */
export interface HarnessProfileRef {
  readonly id: ProfileId;
  readonly version: string;
}
