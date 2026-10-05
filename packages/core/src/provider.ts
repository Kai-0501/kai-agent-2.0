/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Provider-neutral canonical turn types and the ModelProvider port.
 * Decision: docs/adr/0011-provider-extensibility-boundary.md · Gemini mapping: docs/specs/gemini-provider.md
 *
 * The canonical step model is a superset shaped by the richest provider (Gemini Interactions
 * steps), not the poorest (chat completions). Core branches on ModelCapabilities, never on
 * provider or model names.
 */
import type { ContentHash, ReasoningEffort, TurnId } from "@kai/protocol";

export type ProviderId = "gemini" | "fake" | (string & {});
export type ModelId = string;

/** JSON Schema object for function parameters (generated from Zod in the implementation). */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parametersJsonSchema: JsonSchema;
}

/** Opaque provider continuation, e.g. { provider: "gemini", interactionId }. */
export interface StateHandle {
  readonly provider: ProviderId;
  readonly ref: string;
}

export type CanonicalStep =
  | { readonly kind: "user_text"; readonly text: string }
  | { readonly kind: "harness_notice"; readonly noticeType: string; readonly text: string } // rendered as <kai_notice>
  | {
      readonly kind: "function_result";
      readonly providerCallId: string;
      readonly name: string;
      readonly result: string | Readonly<Record<string, unknown>>;
      readonly isError: boolean;
    }
  // The following are only sent in stateless replay, verbatim from stored raw responses:
  | { readonly kind: "model_text"; readonly text: string }
  | { readonly kind: "function_call"; readonly providerCallId: string; readonly name: string; readonly args: unknown }
  | { readonly kind: "opaque_reasoning"; readonly provider: ProviderId; readonly payload: unknown }; // e.g. Gemini thought step + signature

export interface ModelCapabilities {
  readonly provider: ProviderId;
  readonly model: ModelId;
  readonly stateModes: readonly ("chained" | "stateless")[];
  /** Supported effort levels after probing; the provider clamps requests to these. */
  readonly effortLevels: readonly ReasoningEffort[];
  readonly parallelToolCalls: boolean;
  readonly allowedToolsRestriction: boolean;
  readonly usageFields: { readonly cached: boolean; readonly reasoning: boolean };
  readonly inputTokenLimit: number;
  readonly outputTokenLimit: number;
  readonly builtInTools: readonly string[];
  /** Whether changing tool declarations within a chained context keeps the cache valid (G2). */
  readonly toolChangesWithinChainAreCacheSafe: boolean | "unknown";
}

export interface ProviderTurnRequest<O = unknown> {
  readonly turnId: TurnId;
  readonly model: ModelId;
  readonly stateMode: "chained" | "stateless";
  /** Present when continuing a chain within an epoch. */
  readonly continuation?: StateHandle;
  readonly systemInstruction: string;
  readonly tools: readonly ToolDeclaration[];
  /** Chained: only the new steps. Stateless: the full epoch (seed + tail). */
  readonly input: readonly CanonicalStep[];
  readonly effort: ReasoningEffort;
  readonly allowedTools?: readonly string[];
  readonly maxOutputTokens?: number;
  /** Typed provider-specific options (discriminated by provider), e.g. GeminiOptions. */
  readonly providerOptions?: O;
}

/** REPORTED usage, verbatim from the provider (never mixed with estimates). */
export interface TurnUsage {
  readonly inputTokens: number;
  readonly cachedTokens: number;
  readonly thoughtTokens: number;
  readonly outputTokens: number;
  readonly toolUseTokens: number;
  readonly totalTokens: number;
}

export type TurnStatus = "completed" | "requires_action" | "incomplete" | "failed" | "cancelled" | "budget_exceeded";

export type ProviderErrorKind =
  | "rate_limited"
  | "unavailable"
  | "invalid_request"
  | "signature_invalid"
  | "state_expired"
  | "degenerate_output"
  | "model_failed"
  | "budget_exceeded"
  | "network";

export type ProviderTurnEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "thought_summary_delta"; readonly text: string }
  | { readonly type: "tool_call_started"; readonly providerCallId: string; readonly name: string }
  | { readonly type: "tool_call_args_delta"; readonly providerCallId: string; readonly delta: string }
  /** Complete function call: safe to execute. */
  | { readonly type: "tool_call"; readonly providerCallId: string; readonly name: string; readonly args: unknown }
  | { readonly type: "opaque_reasoning"; readonly payload: unknown }
  | {
      readonly type: "completed";
      readonly status: TurnStatus;
      readonly usage: TurnUsage;
      readonly continuation: StateHandle;
      /** Blob of the full raw provider response, for stateless replay and debugging. */
      readonly rawRef?: ContentHash;
    }
  | { readonly type: "error"; readonly kind: ProviderErrorKind; readonly retryable: boolean; readonly message: string };

export interface ModelProvider<O = unknown> {
  readonly id: ProviderId;
  describe(model: ModelId): Promise<ModelCapabilities>;
  runTurn(req: ProviderTurnRequest<O>, signal: AbortSignal): AsyncIterable<ProviderTurnEvent>;
}
