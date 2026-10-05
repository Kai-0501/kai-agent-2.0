/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * @kai/provider-gemini: native Gemini Interactions API provider via the first-party @google/genai SDK
 * (to be added as a pinned dependency in Phase 1). No OpenAI-compatible shim.
 * Spec: docs/specs/gemini-provider.md · Decision: docs/adr/0003 · Research: docs/research/gemini-api.md
 *
 * Mapping summary (canonical → Interactions):
 *   systemInstruction            → system_instruction
 *   ToolDeclaration              → { type: "function", name, description, parameters }
 *   effort                       → generation_config.thinking_level (clamped to probed levels)
 *   allowedTools                 → generation_config.tool_choice = { allowed_tools: { mode, tools } }
 *   user_text / harness_notice   → { type: "user_input", content: [{ type: "text", text }] }
 *   function_result              → { type: "function_result", call_id, name, result, is_error }
 *   (stateless) model/thought/fc → original steps verbatim from the stored raw response
 *   continuation (chained)       → previous_interaction_id
 *   stateMode "stateless"        → store: false
 * Never set: temperature, top_p (deprecated; keep Gemini 3 default 1.0), cached_content (deprecated).
 */
import type { ModelCapabilities, ModelProvider } from "@kai/core";

export const DEFAULT_GEMINI_MODEL = "gemini-3.8-flash" as const;

/** Values of the Interactions `ThinkingLevel` enum in @google/genai v2.27.0 (support per model is probed). */
export type GeminiThinkingLevel = "minimal" | "low" | "medium" | "high";

/** Interactions `ServiceTier` values used by Kai (the API also defines "deferred"). */
export type GeminiServiceTier = "standard" | "flex" | "priority";

export type GeminiBuiltInTool = "google_search" | "url_context" | "code_execution";

/** Typed provider-specific options carried in ProviderTurnRequest.providerOptions. */
export interface GeminiOptions {
  readonly provider: "gemini";
  readonly serviceTier?: GeminiServiceTier;
  readonly thinkingSummaries?: "auto" | "none";
  readonly builtInTools?: readonly GeminiBuiltInTool[];
  readonly labels?: Readonly<Record<string, string>>; // kai_session, kai_epoch, kai_turn
}

/** Capabilities established by probing (docs/research/gemini-api.md#open-questions G1–G10; G2/G10 flags live in ModelCapabilities). */
export interface GeminiModelCapabilities extends ModelCapabilities {
  readonly provider: "gemini";
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
  describe(model: string): Promise<GeminiModelCapabilities>;
}

/** Streaming degenerate-output guard (Gemini CLI heuristic): abort when a 50-char chunk repeats ≥ 10×. */
export interface DegenerateOutputGuardConfig {
  readonly chunkSize: number; // 50
  readonly repeatThreshold: number; // 10
}
