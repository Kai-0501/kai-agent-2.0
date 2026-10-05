/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * Provider-neutral canonical turn types, capability snapshots and the ModelProvider port.
 * Decisions: docs/adr/0011-provider-extensibility-boundary.md, docs/adr/0018-providers-routes-profiles-capabilities.md
 * Adapters: docs/specs/gemini-provider.md, docs/specs/openai-responses-provider.md, docs/specs/compatible-endpoints.md
 *
 * The canonical step model is a superset shaped by the richest providers (Gemini Interactions
 * steps, OpenAI Responses items), not the poorest (chat completions). Core branches on the
 * capability snapshot, never on provider, route, profile or model names.
 */
import type {
  AppliedEffort,
  CapabilitySnapshotId,
  ContentHash,
  EffortLevel,
  EndpointId,
  ProfileId,
  RouteId,
  TurnId,
  UsageClass,
} from "@kai/protocol";

export type ProviderId = "gemini" | "openai" | "compatible" | "fake";
export type ModelId = string;

/** Tri-state support with provenance (docs/adr/0018). Unknown is never treated as supported. */
export type Support = "supported" | "unsupported" | "unknown";
export interface SupportFact {
  readonly support: Support;
  readonly provenance: "probe" | "metadata" | "model_facts" | "override:user" | "api_error" | "default";
  readonly detail?: string;
}

/** JSON Schema object for function parameters (generated from Zod in the implementation). */
export type JsonSchema = Readonly<Record<string, unknown>>;

export interface ToolDeclaration {
  readonly name: string;
  readonly description: string;
  readonly parametersJsonSchema: JsonSchema;
}

/** Opaque provider continuation, e.g. { provider: "gemini", ref: interactionId }. Optional per route. */
export interface StateHandle {
  readonly provider: ProviderId;
  readonly routeId: RouteId;
  readonly ref: string;
}

/** Tag that binds provider-native replay items to where they came from. Mismatch → dropped. */
export interface ReplayTag {
  readonly provider: ProviderId;
  readonly routeId: RouteId;
  readonly accountScope?: string; // opaque hash of the account key (subscription routes)
  readonly model: ModelId;
}

export type CanonicalStep =
  | { readonly kind: "user_text"; readonly text: string }
  | { readonly kind: "harness_notice"; readonly noticeType: string; readonly text: string } // <kai_notice>; role chosen by the profile
  | {
      readonly kind: "function_result";
      readonly providerCallId: string;
      readonly name: string;
      readonly result: string | Readonly<Record<string, unknown>>;
      readonly isError: boolean;
    }
  // Local replay of earlier model output (providers without native items, e.g. chat completions):
  | { readonly kind: "model_text"; readonly text: string }
  | { readonly kind: "function_call"; readonly providerCallId: string; readonly name: string; readonly args: unknown }
  // Provider-native items replayed verbatim (Gemini thought steps with signatures, OpenAI reasoning
  // items with encrypted_content, message items with phase, compatible reasoning_content):
  | {
      readonly kind: "replay_native";
      readonly tag: ReplayTag;
      readonly itemKind: "reasoning" | "message" | "function_call" | "other";
      readonly payloadRef: ContentHash; // blob with the exact provider item
    };

/** How reasoning effort can be controlled on this model (docs/specs/harness-profiles.md#effort-policy). */
export type EffortControl =
  | { readonly control: "none" }
  | {
      readonly control: "levels";
      /** Ordered low → high; canonical position of each native level. */
      readonly levels: readonly { readonly canonical: EffortLevel; readonly native: string }[];
      /** Whether changing effort between requests keeps provider caches valid. */
      readonly changeCacheSafe: Support;
    };

/**
 * Effective capabilities of ONE model on ONE endpoint through ONE route for ONE account.
 * Recorded as an event on first use (CapabilitySnapshotRecorded) and pinned in ModelRequest.
 */
export interface CapabilitySnapshot {
  readonly id: CapabilitySnapshotId; // content-derived
  readonly provider: ProviderId;
  readonly routeId: RouteId;
  readonly endpointId?: EndpointId;
  readonly accountScope?: string;
  readonly model: ModelId;
  readonly adapterVersion: string;
  readonly takenAt: string;
  readonly continuation: { readonly providerChain: Support; readonly localReplay: Support };
  readonly effort: EffortControl;
  readonly toolCalling: SupportFact;
  readonly parallelToolCalls: SupportFact;
  readonly allowedToolsRestriction: SupportFact;
  readonly structuredReview: SupportFact; // reliable enough for submit_review (critic)
  readonly imageInput: SupportFact;
  readonly usageFields: {
    readonly input: Support;
    readonly cached: Support;
    readonly reasoning: Support;
    readonly output: Support;
    readonly reasoningIncludedInOutput: boolean;
  };
  readonly limits: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly source: "model_facts" | "catalog" | "metadata" | "declared" | "probe" | "default_conservative";
  };
  readonly tokenizer: "known" | "unknown"; // known = reported usage has calibrated the estimator
  readonly toolChangesWithinChainAreCacheSafe: Support; // G2
  readonly mode: "agent" | "chat_only";
  /**
   * Whether a chained request's reported input includes the previous response's output / thoughts (G10).
   * Used by request preflight and complete request accounting. "unknown" → assume output yes, thoughts no,
   * and keep the projection conservative.
   */
  readonly chainedInputIncludesPriorOutput: Support;
  readonly chainedInputIncludesPriorThoughts: Support;
}

/** Founding name, kept so the founding specs still read correctly. */
export type ModelCapabilities = CapabilitySnapshot;

export interface ProviderTurnRequest<O = unknown> {
  readonly turnId: TurnId;
  readonly routeId: RouteId;
  readonly profile: `${ProfileId}@${string}`;
  readonly model: ModelId;
  readonly continuationMode: "provider_chain" | "local_replay";
  /** Present only when continuing a provider chain within an epoch. */
  readonly continuation?: StateHandle;
  readonly systemInstruction: string; // Gemini system_instruction · Responses instructions · chat system/developer
  readonly tools: readonly ToolDeclaration[];
  /** provider_chain: only the new steps. local_replay: the full epoch (seed + tail). */
  readonly input: readonly CanonicalStep[];
  readonly effort: { readonly intent: EffortLevel; readonly native?: string };
  readonly allowedTools?: readonly string[];
  readonly maxOutputTokens?: number; // dropped by route builders that do not support it
  /** Typed provider-specific options (discriminated by provider), e.g. GeminiOptions. */
  readonly providerOptions?: O;
}

/** REPORTED usage, verbatim from the provider. null = the route did not report the field. */
export interface TurnUsage {
  readonly inputTokens: number | null;
  readonly cachedTokens: number | null;
  readonly reasoningTokens: number | null; // Gemini thought tokens; OpenAI reasoning tokens
  readonly outputTokens: number | null;
  readonly toolUseTokens: number | null;
  readonly totalTokens: number | null;
  readonly reasoningIncludedInOutput: boolean; // from the snapshot; prevents double counting
  readonly usageClass: UsageClass;
}

export type TurnStatus = "completed" | "requires_action" | "incomplete" | "failed" | "cancelled" | "budget_exceeded" | "interrupted";

export type ProviderErrorKind =
  | "rate_limited"
  | "unavailable"
  | "invalid_request"
  | "unsupported_parameter"
  | "context_length"
  | "signature_invalid"
  | "state_expired"
  | "degenerate_output"
  | "model_failed"
  | "content_filter"
  | "budget_exceeded"
  | "network"
  | "stream_interrupted" // connection lost before the terminal event; nothing from the attempt executes
  | "invalid_tool_call" // compatible endpoints: malformed or incomplete call; never executed
  | "auth_required" // route must refresh or re-authenticate
  | "quota_exhausted" // e.g. subscription_sharing_usage_limit_exceeded; never auto-switch routes
  | "usage_unavailable" // e.g. subscription_sharing_usage_unavailable
  | "model_unavailable"
  | "redirect_refused";

export type ProviderTurnEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | { readonly type: "thought_summary_delta"; readonly text: string }
  | { readonly type: "tool_call_started"; readonly providerCallId: string; readonly name: string }
  | { readonly type: "tool_call_args_delta"; readonly providerCallId: string; readonly delta: string }
  /** Complete, validated function call. Emitted only after the terminal "completed" event. */
  | { readonly type: "tool_call"; readonly providerCallId: string; readonly name: string; readonly args: unknown }
  | {
      readonly type: "completed";
      readonly status: TurnStatus;
      readonly usage: TurnUsage;
      /** Absent when the route has no provider-side continuation (docs/adr/0018). */
      readonly continuation?: StateHandle;
      /** Provider-native items of this response, stored for local replay. */
      readonly replayItems?: readonly Extract<CanonicalStep, { kind: "replay_native" }>[];
      /** Blob of the full raw provider response, for replay and debugging. */
      readonly rawRef?: ContentHash;
    }
  | { readonly type: "error"; readonly kind: ProviderErrorKind; readonly retryable: boolean; readonly message: string };

export interface ModelProvider<O = unknown> {
  readonly id: ProviderId;
  readonly adapterVersion: string;
  /** Builds (or returns the cached) snapshot for this route/model/account. Probes only when asked. */
  describe(routeId: RouteId, model: ModelId, opts: { readonly probe: boolean }, signal: AbortSignal): Promise<CapabilitySnapshot>;
  /** Discovered model catalog for the route (no fixed picker). */
  listModels(routeId: RouteId, signal: AbortSignal): Promise<readonly { readonly slug: string; readonly displayName: string }[]>;
  runTurn(req: ProviderTurnRequest<O>, signal: AbortSignal): AsyncIterable<ProviderTurnEvent>;
}

/** Recorded with every request for audit (docs/specs/reasoning-governor.md). */
export interface EffortRecord {
  readonly requested: EffortLevel;
  readonly applied: AppliedEffort;
  readonly native?: string;
}
