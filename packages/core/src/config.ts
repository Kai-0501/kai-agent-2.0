/**
 * SCAFFOLD: types + documented defaults only. Not an implementation.
 *
 * Config schema v2 (docs/specs/configuration.md). Every threshold in the specs is a config key
 * here, and every mechanism has an ablation switch (docs/adr/0014-measurement-gated-mechanisms.md).
 * Defaults are starting points to be calibrated by the benchmark. Phase 0 turns this into a Zod
 * schema with layered loading (defaults → user → workspace [restrict-only for safety keys] →
 * session → flags) and the v1 → v2 migration below.
 *
 * Secrets are never config values: routes reference `env:<VAR>` or a Keychain CredentialRef.
 */
import type { EffortLevel, EndpointId, ProfileId, RouteId } from "@kai/protocol";
import type { ContextBudget } from "./context.js";
import type { ReleaseDistribution } from "./credentials.js";
import type { RepairBudgets } from "./repair.js";

/** "env:GEMINI_API_KEY" or a CredentialRef ("cred_…"). Inline secrets fail validation. */
export type CredentialSource = `env:${string}` | `cred_${string}`;

export interface RouteConfig {
  readonly credential?: CredentialSource;
  readonly profile: ProfileId;
  readonly gemini?: { readonly stateMode: "chained" | "stateless"; readonly serviceTier: "standard" | "flex" | "priority"; readonly thinkingSummaries: "auto" | "none" };
  readonly openai?: { readonly storeResponses: boolean; readonly allowXhighReplan: boolean };
  readonly selectedAccount?: string; // AccountKey for openai.chatgpt_subscription
}

/** docs/specs/compatible-endpoints.md#configuration */
export interface EndpointConfig {
  readonly label: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly dialect: "chat_completions" | "responses";
  readonly auth: { readonly kind: "none" } | { readonly kind: "bearer"; readonly credential: CredentialSource } | { readonly kind: "header"; readonly name: "api-key" | "x-api-key"; readonly credential: CredentialSource };
  readonly network: { readonly scope: "public" | "loopback" | "lan" };
  readonly privacy: "cloud" | "local_only";
  readonly limits?: { readonly contextTokens?: number; readonly maxOutputTokens?: number };
  readonly timeouts?: { readonly connectMs?: number; readonly firstByteMs?: number; readonly idleMs?: number; readonly totalMs?: number };
  readonly capabilityOverrides?: Readonly<Record<string, "supported" | "unsupported">>;
  /** Allowlist only: top_k, min_p, repeat_penalty, seed, stop, reasoning_effort, chat_template_kwargs. */
  readonly providerOptions?: Readonly<Record<string, string | number | boolean | readonly string[] | Readonly<Record<string, string | number | boolean>>>>;
  readonly tls?: { readonly caFile?: string };
  readonly experimentalTextTools?: boolean; // off; read-only tools only
}

export interface KaiConfig {
  readonly schemaVersion: 2;
  readonly release: { readonly distribution: ReleaseDistribution };
  readonly app: { readonly offline: boolean; readonly locale: string };
  readonly defaults: { readonly routeId: RouteId; readonly model: string };
  readonly routes: Readonly<Partial<Record<RouteId, RouteConfig>>>;
  readonly endpoints: Readonly<Record<EndpointId | string, EndpointConfig>>;
  readonly context: ContextBudget & { readonly enabledEpochs: boolean };
  readonly ledger: { readonly enabled: boolean; readonly partialMinFraction: number; readonly diffMaxFraction: number; readonly inlineStaleMaxTokens: number };
  readonly shaper: { readonly enabled: boolean; readonly inlineMax: number; readonly shapedMax: number; readonly maxFailuresListed: number; readonly excerptFailures: number };
  readonly readFile: { readonly outlineThresholdLines: number; readonly lineNumbers: boolean };
  readonly firewall: { readonly mode: "enforce" | "advisory" | "off"; readonly budgetMsTs: number; readonly budgetMsPython: number; readonly dependents: number };
  readonly governor: { readonly mode: "adaptive" | { readonly fixed: EffortLevel } };
  readonly repair: RepairBudgets & { readonly enabled: boolean };
  readonly critic: { readonly mode: "auto" | "always" | "off"; readonly maxTokensPerTask: number; readonly requiredTriggers: readonly string[] };
  readonly tools: { readonly exposure: "core_plus_packs" | "all" };
  readonly verify: { readonly backgroundT2: boolean; readonly flakyReruns: number; readonly baselineFlakyRuns: number; readonly maxTargetedTests: number };
  readonly shell: { readonly defaultTimeoutS: number };
  readonly learning: {
    readonly enabled: boolean;
    readonly retrieval: { readonly enabled: boolean; readonly maxCards: number; readonly maxTokens: number; readonly cardMaxTokens: number };
    readonly reflection: { readonly enabled: boolean; readonly route: "project_last_route" | RouteId; readonly maxInputTokens: number; readonly maxOutputTokens: number; readonly maxEvidenceReads: number; readonly skipBelowProjectTokens: number };
    readonly skillMaxTokens: number;
    readonly promotion: { readonly validatedMinProjects: number };
    readonly contradiction: { readonly retireAfter: number };
    readonly expiry: { readonly unusedDays: number };
    readonly finalization: { readonly idleDays: number };
    readonly privacy: { readonly allowCloudForLocalOnly: boolean };
  };
  readonly research: {
    readonly mode: "off" | "ask_first_use" | "enabled";
    readonly queryPrivacy: "strict" | "standard";
    readonly chrome: { readonly path: string | null; readonly minMajor: number };
    readonly blockedDomains: readonly string[];
    readonly preferredDomains: readonly string[];
    readonly allowedPorts: readonly number[];
    readonly visualFallback: "user_only" | "model";
    readonly searchesPerTask: number;
    readonly opensPerTask: number;
    readonly outputTokensPerTask: number;
    readonly cacheTtlHours: number;
    readonly artifactRetentionDays: number;
    readonly artifactMaxTotalMB: number;
  };
}

export const DEFAULT_CONFIG: KaiConfig = {
  schemaVersion: 2,
  release: { distribution: "personal_local" },
  app: { offline: false, locale: "en" },
  defaults: { routeId: "gemini.api_key", model: "gemini-3.8-flash" },
  routes: {
    "gemini.api_key": { credential: "env:GEMINI_API_KEY", profile: "gemini", gemini: { stateMode: "chained", serviceTier: "standard", thinkingSummaries: "none" } },
    "openai.api_key": { credential: "env:OPENAI_API_KEY", profile: "openai", openai: { storeResponses: false, allowXhighReplan: false } },
    "openai.chatgpt_subscription": { profile: "openai" },
  },
  endpoints: {},
  context: {
    enabledEpochs: true,
    seedTarget: 24_000,
    reserveOutput: 8_000,
    epochSoftLimit: 64_000,
    epochHardLimit: 160_000,
    repoMapMin: 2_000,
    repoMapMax: 6_000,
    repoMapColdStart: 8_000,
    inlineToolResultMax: 2_000,
    noticeMax: 300,
    safetyMargin: 31_457, // Gemini 1M window: max(512, 3%); profiles recompute per snapshot
    elisionBatchTokens: 20_000,
  },
  ledger: { enabled: true, partialMinFraction: 0.3, diffMaxFraction: 0.4, inlineStaleMaxTokens: 400 },
  shaper: { enabled: true, inlineMax: 2_000, shapedMax: 1_200, maxFailuresListed: 10, excerptFailures: 3 },
  readFile: { outlineThresholdLines: 300, lineNumbers: true },
  firewall: { mode: "enforce", budgetMsTs: 2_500, budgetMsPython: 3_500, dependents: 10 },
  governor: { mode: "adaptive" },
  repair: { enabled: true, maxAttemptsPerFailure: 3, maxAttemptsPerTask: 8, maxReplans: 2, maxRepairTokenShare: 0.4 },
  critic: { mode: "auto", maxTokensPerTask: 60_000, requiredTriggers: [] },
  tools: { exposure: "core_plus_packs" },
  verify: { backgroundT2: true, flakyReruns: 2, baselineFlakyRuns: 3, maxTargetedTests: 200 },
  shell: { defaultTimeoutS: 120 },
  learning: {
    enabled: true,
    retrieval: { enabled: true, maxCards: 3, maxTokens: 600, cardMaxTokens: 220 },
    reflection: { enabled: true, route: "project_last_route", maxInputTokens: 16_000, maxOutputTokens: 2_000, maxEvidenceReads: 4, skipBelowProjectTokens: 20_000 },
    skillMaxTokens: 350,
    promotion: { validatedMinProjects: 2 },
    contradiction: { retireAfter: 2 },
    expiry: { unusedDays: 90 },
    finalization: { idleDays: 14 },
    privacy: { allowCloudForLocalOnly: false },
  },
  research: {
    mode: "ask_first_use",
    queryPrivacy: "strict",
    chrome: { path: null, minMajor: 136 },
    blockedDomains: [],
    preferredDomains: [],
    allowedPorts: [80, 443],
    visualFallback: "user_only",
    searchesPerTask: 10,
    opensPerTask: 25,
    outputTokensPerTask: 25_000,
    cacheTtlHours: 24,
    artifactRetentionDays: 30,
    artifactMaxTotalMB: 500,
  },
};

/** The founding (implicit v1) Gemini-only config shape, for migration only. */
export interface KaiConfigV1 {
  readonly gemini: { readonly model: string; readonly stateMode: "chained" | "stateless"; readonly serviceTier: "standard" | "flex" | "priority"; readonly thinkingSummaries: "auto" | "none" };
  readonly [key: string]: unknown; // context, ledger, shaper, … keep their paths
}

/** Pure, idempotent v1 → v2 migration (docs/specs/configuration.md#migration-from-the-gemini-only-config). */
export type ConfigMigration = (input: KaiConfigV1 | KaiConfig) => { readonly config: KaiConfig; readonly migrated: boolean; readonly keysMoved: readonly string[] };
