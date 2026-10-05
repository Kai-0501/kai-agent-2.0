/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * @kai/provider-openai: OpenAI Responses API adapter for two credential routes:
 *   - openai.api_key                 (metered API usage)
 *   - openai.chatgpt_subscription    (Sign in with ChatGPT plan usage; preview limitations)
 * Each route has an ALLOWLIST request builder: only listed top-level keys can ever be emitted,
 * and keys whose capability is "unsupported" are dropped (property-tested).
 * Spec: docs/specs/openai-responses-provider.md · Decisions: docs/adr/0019, docs/adr/0020
 * Research: docs/research/extension-2026-10.md §2 (open questions O4–O8)
 *
 * Mapping summary (canonical → Responses):
 *   systemInstruction        → instructions            (explicit "system" input items are rejected on the subscription route)
 *   user_text                → {type:"message", role:"user", content:[{type:"input_text"}]}
 *   harness_notice           → {type:"message", role:"developer", …}   (openai profile)
 *   function_result          → {type:"function_call_output", call_id, output}
 *   replay_native            → stored output items verbatim (reasoning+encrypted_content, message+phase, function_call)
 *   ToolDeclaration          → {type:"function", name, description, parameters, strict:false}
 *   effort (intent)          → reasoning.effort (native level from the snapshot)
 * Success = terminal `response.completed` only. incomplete/failed/error/disconnect → no tool executes.
 */
import type { CapabilitySnapshot, ModelProvider, Support } from "@kai/core";
import type { AccountKey } from "@kai/protocol";

export type OpenAIRouteId = "openai.api_key" | "openai.chatgpt_subscription";

/** Top-level body keys the subscription route may send (documented; DI in the research note). */
export type SubscriptionRequestKey =
  | "model"
  | "instructions"
  | "input"
  | "stream" // must be true
  | "store" // must be false
  | "include" // ["reasoning.encrypted_content"] (O5)
  | "tools"
  | "tool_choice"
  | "reasoning"
  | "parallel_tool_calls" // only if probed supported (O8)
  | "prompt_cache_key"; // only if probed supported (O8)

/** Documented as unsupported on the subscription route: never emitted. */
export type SubscriptionForbiddenKey =
  | "previous_response_id"
  | "background"
  | "conversation"
  | "max_output_tokens"
  | "max_tool_calls"
  | "metadata"
  | "moderation"
  | "multi_agent"
  | "prompt"
  | "prompt_cache_retention"
  | "safety_identifier"
  | "temperature"
  | "top_logprobs"
  | "top_p"
  | "truncation"
  | "user";

/** Top-level keys the API-key route may send. */
export type ApiKeyRequestKey =
  | Exclude<SubscriptionRequestKey, never>
  | "previous_response_id" // only with store:true inside an epoch
  | "max_output_tokens"
  | "metadata"
  | "service_tier";

/** Compile-time guard: no forbidden key is allowlisted for the subscription route. */
export type AssertDisjoint<A, B> = [Extract<A, B>] extends [never] ? true : false;
export type SubscriptionAllowlistIsClean = AssertDisjoint<SubscriptionRequestKey, SubscriptionForbiddenKey>;
type MustBeTrue<T extends true> = T;
/** Fails to compile if a forbidden key is ever added to the subscription allowlist. */
export type SubscriptionAllowlistCheck = MustBeTrue<SubscriptionAllowlistIsClean>;

export interface OpenAIOptions {
  readonly provider: "openai";
  readonly storeResponses?: boolean; // API-key route only; default false
  readonly serviceTier?: "auto" | "default" | "flex" | "priority"; // API-key route only
  readonly reasoningSummary?: "auto" | "none"; // only with --debug
}

export interface OpenAICapabilitySnapshot extends CapabilitySnapshot {
  readonly provider: "openai";
  readonly routeId: OpenAIRouteId;
  readonly responsesFeatures: {
    readonly previousResponseId: Support; // subscription: "unsupported"
    readonly encryptedReasoning: Support; // O5
    readonly toolPackaging: "top_level" | "namespace" | "additional_tools" | "unknown"; // O6
    readonly allowedToolsChoice: Support;
    readonly parallelToolCalls: Support;
    readonly promptCacheKey: Support;
    readonly maxOutputTokens: Support; // subscription: "unsupported"
    readonly phaseField: Support; // O7
  };
}

/** Classified Responses stream outcomes (only "completed" releases tool calls). */
export type ResponsesTerminal =
  | { readonly kind: "completed" }
  | { readonly kind: "incomplete"; readonly reason: "max_output_tokens" | "content_filter" | string }
  | { readonly kind: "failed"; readonly code?: string }
  | { readonly kind: "error"; readonly code?: string }
  | { readonly kind: "disconnected" };

/** Error codes with route-level meaning (subscription preview; docs/specs/openai-responses-provider.md#errors-and-retries). */
export type SubscriptionErrorCode =
  | "subscription_sharing_usage_limit_exceeded" // 429 → route quota_exhausted, task blocked, no switch
  | "subscription_sharing_usage_unavailable"; // 503 → retry 3×, then usage_unavailable

/** A versioned row of the model-facts table; every row cites its source. */
export interface ModelFact {
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly effortLevels: readonly string[]; // native names, low → high; [] = no control
  readonly sourceUrl: string;
  readonly accessed: string; // ISO date
}

export interface OpenAIProvider extends ModelProvider<OpenAIOptions> {
  readonly id: "openai";
  describe(routeId: OpenAIRouteId, model: string, opts: { readonly probe: boolean }, signal: AbortSignal): Promise<OpenAICapabilitySnapshot>;
  /** Subscription catalog: GET /v1/models with the route's bearer token, visibility == "list" (O4). */
  catalog(routeId: OpenAIRouteId, accountKey: AccountKey | undefined, signal: AbortSignal): Promise<readonly { readonly slug: string; readonly displayName: string }[]>;
}
