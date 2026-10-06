/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * @kai/provider-gemini: native Gemini Interactions API adapter via the first-party @google/genai SDK
 * (a pinned dependency of the implementation). No OpenAI-compatible shim. Serves the
 * `gemini.api_key` route; model-facing behaviour is the `gemini` harness profile.
 * Spec: docs/specs/gemini-provider.md · Decisions: docs/adr/0003, docs/adr/0018 · Research: docs/research/gemini-api.md
 *
 * Mapping summary (canonical → Interactions):
 *   systemInstruction            → system_instruction
 *   ToolDeclaration              → { type: "function", name, description, parameters }
 *   effort (canonical intent)    → generation_config.thinking_level (mapped to probed levels; none→minimal, xhigh→high)
 *   allowedTools                 → generation_config.tool_choice = { allowed_tools: { mode, tools } }
 *   user_text / harness_notice   → { type: "user_input", content: [{ type: "text", text }] }
 *   function_result              → { type: "function_result", call_id, name, result, is_error }
 *   replay_native (stateless)    → original model_output/thought/function_call steps verbatim (tag must match)
 *   continuation (provider_chain)→ previous_interaction_id
 *   stateMode "stateless"        → store: false
 * Never set: temperature, top_p (deprecated; keep Gemini 3 default 1.0), cached_content (deprecated).
 * Built-in tools are not used for research (shared Chrome research service, docs/adr/0023).
 */
import type { CapabilitySnapshot, ModelProvider } from "@kai/core";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash" as const;

/** Values of the Interactions `ThinkingLevel` enum in @google/genai v2.27.0 (support per model is probed). */
export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

/** Interactions `ServiceTier` values used by Kai (the API also defines "deferred"). */
export type GeminiServiceTier = "standard" | "flex" | "priority";

/** Off by default; not a product dependency (research goes through Chrome, docs/adr/0023). */
export type GeminiBuiltInTool = "google_search" | "url_context" | "code_execution";

/** Typed provider-specific options carried in ProviderTurnRequest.providerOptions. */
export interface GeminiOptions {
  readonly provider: "gemini";
  readonly serviceTier?: GeminiServiceTier;
  readonly thinkingSummaries?: "auto" | "none";
  readonly builtInTools?: readonly GeminiBuiltInTool[];
  readonly labels?: Readonly<Record<string, string>>; // kai_session, kai_epoch, kai_turn
}

/** Capabilities established by probing (docs/research/gemini-api.md#open-questions G1–G10; G2/G10 flags live in CapabilitySnapshot). */
export interface GeminiModelCapabilities extends CapabilitySnapshot {
  readonly provider: "gemini";
  readonly routeId: "gemini.api_key";
  readonly thinkingLevels: readonly GeminiThinkingLevel[]; // G4
  readonly chainedRequiresToolsEachTurn: boolean | "unknown"; // G1 (default: re-send every turn)
  readonly statelessSupported: boolean;
  readonly probedAt: string;
  readonly sdkVersion: string;
}

/** Internal transport seam: v1 ships Interactions only; generateContent may be added for Vertex or explicit caching. */
export type GeminiTransportKind = "interactions" | "generate_content";

export interface GeminiProvider extends ModelProvider<GeminiOptions> {
  readonly id: "gemini";
  describe(routeId: "gemini.api_key", model: string, opts: { readonly probe: boolean }, signal: AbortSignal): Promise<GeminiModelCapabilities>;
}

/** Streaming degenerate-output guard (Gemini CLI heuristic): abort when a 50-char chunk repeats ≥ 10×. */
export interface DegenerateOutputGuardConfig {
  readonly chunkSize: number; // 50
  readonly repeatThreshold: number; // 10
}
