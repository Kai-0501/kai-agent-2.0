/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * @kai/provider-compatible: adapter for user-configured OpenAI-compatible endpoints (hosted or
 * local). Chat Completions is the baseline dialect; Responses only when probes confirm it.
 * Configuration is DATA, never code: no package names, no templates, allowlisted provider
 * options. Capabilities are probed (tri-state) and cached by (endpointId, configRevision,
 * adapterVersion). Tool calls are validated WHOLE before execution.
 * Spec: docs/specs/compatible-endpoints.md · Decision: docs/adr/0021
 */
import type { CapabilitySnapshot, EndpointConfig, ModelProvider, Support } from "@kai/core";
import type { ContentHash, EndpointDoctorReport, EndpointId } from "@kai/protocol";

export type CompatDialect = EndpointConfig["dialect"];
export type NetworkScope = EndpointConfig["network"]["scope"];

/** Allowlisted providerOptions keys (anything else fails config validation). */
export type ProviderOptionKey = "top_k" | "min_p" | "repeat_penalty" | "seed" | "stop" | "reasoning_effort" | "chat_template_kwargs";

/** Header names allowed for `auth.kind: "header"`. */
export type AuthHeaderName = "api-key" | "x-api-key";

export type ProbeId = "P0_models" | "P1_text" | "P2_stream" | "P3_tool_call" | "P4_parallel" | "P5_round_trip" | "P6_roles" | "P7_nested_schema" | "P8_reasoning_replay" | "P9_reliability";

export interface ProbeResult {
  readonly id: ProbeId;
  readonly support: Support;
  readonly billable: boolean;
  readonly ms?: number;
  readonly note?: string;
}

export interface CompatibleCapabilitySnapshot extends CapabilitySnapshot {
  readonly provider: "compatible";
  readonly endpointId: EndpointId;
  readonly configRevision: ContentHash; // baseUrl, model, dialect, auth.kind, providerOptions, limits
  readonly serverHint?: string; // display only; never a capability signal
  readonly features: {
    readonly streaming: Support;
    readonly usageReported: Support;
    readonly streamUsage: Support;
    readonly toolCalling: Support;
    readonly toolChoiceForms: readonly ("named" | "required" | "auto" | "none")[];
    readonly parallelToolCalls: Support;
    readonly developerRole: Support;
    readonly nestedSchemas: Support;
    readonly reasoningReplayRequired: Support;
    readonly toolReliability: { readonly valid: number; readonly attempts: number }; // 3/3 required for agent mode
  };
  readonly probes: readonly ProbeResult[];
}

/** Outcome of assembling and validating a streamed tool call. Only "valid" may execute. */
export type AssembledToolCall =
  | { readonly status: "valid"; readonly callId: string; readonly name: string; readonly args: unknown }
  | { readonly status: "invalid"; readonly reason: "incomplete" | "malformed_json" | "unknown_tool" | "schema_invalid"; readonly detail: string };

/** Network check result for a connection attempt (checked against the address actually used). */
export interface ScopeCheck {
  readonly declared: NetworkScope;
  readonly resolvedAddress: string;
  readonly addressClass: "loopback" | "private" | "link_local" | "public" | "metadata";
  readonly ok: boolean;
}

/**
 * Experimental, off-by-default text-tool protocol "kai-text-tools/1": exactly one fenced block
 * tagged `kai-call` with {"tool", "args"}; read-only tools and update_plan only.
 */
export interface TextToolCall {
  readonly protocol: "kai-text-tools/1";
  readonly tool: string;
  readonly args: unknown;
}

export interface CompatibleProvider extends ModelProvider {
  readonly id: "compatible";
  describe(routeId: `compat:${string}`, model: string, opts: { readonly probe: boolean }, signal: AbortSignal): Promise<CompatibleCapabilitySnapshot>;
  doctor(endpointId: EndpointId, opts: { readonly reprobe: boolean }, signal: AbortSignal): Promise<EndpointDoctorReport>;
}
