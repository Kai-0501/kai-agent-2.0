/**
 * SCAFFOLD: types + documented defaults only. Not an implementation.
 *
 * Every threshold in the specs is a config key here, and every mechanism has an ablation switch
 * (docs/adr/0014-measurement-gated-mechanisms.md). Defaults are starting points to be calibrated
 * by the benchmark (docs/evaluation/benchmark-plan.md). Phase 0 turns this into a Zod schema with
 * layered loading (defaults → user → workspace → flags).
 */
import type { ReasoningEffort } from "@kai/protocol";
import type { ContextBudget } from "./context.js";
import type { RepairBudgets } from "./repair.js";

export interface KaiConfig {
  readonly gemini: {
    readonly model: string;
    readonly stateMode: "chained" | "stateless";
    readonly serviceTier: "standard" | "flex" | "priority";
    readonly thinkingSummaries: "auto" | "none";
  };
  readonly context: ContextBudget & { readonly enabledEpochs: boolean };
  readonly ledger: { readonly enabled: boolean; readonly partialMinFraction: number; readonly diffMaxFraction: number; readonly inlineStaleMaxTokens: number };
  readonly shaper: { readonly enabled: boolean; readonly inlineMax: number; readonly shapedMax: number; readonly maxFailuresListed: number; readonly excerptFailures: number };
  readonly readFile: { readonly outlineThresholdLines: number; readonly lineNumbers: boolean };
  readonly firewall: { readonly mode: "enforce" | "advisory" | "off"; readonly budgetMsTs: number; readonly budgetMsPython: number; readonly dependents: number };
  readonly governor: { readonly mode: "adaptive" | { readonly fixed: ReasoningEffort } };
  readonly repair: RepairBudgets & { readonly enabled: boolean };
  readonly critic: {
    /** Controls the OPTIONAL risk review only. Mandatory integrity review is not disabled by "off". */
    readonly mode: "auto" | "always" | "off";
    readonly maxRiskReviewTokens: number;
    /** Reserved; the risk review cannot consume it. */
    readonly integrityReviewTokens: number;
    /** false = every high-severity unbacked finding needs user approval (or the task ends `blocked`). */
    readonly integrityReview: boolean;
  };
  readonly tools: { readonly exposure: "core_plus_packs" | "all" };
  readonly verify: {
    readonly backgroundT2: boolean;
    readonly maxTargetedTests: number;
    /** Extra runs of a failing test on the current tree (established-only flakiness). */
    readonly rerunsNow: number;
    /** Runs of a failing test on the baseline snapshot. */
    readonly baselineRuns: number;
    readonly flakyWorseningDelta: number;
    readonly flakeHistoryDays: number;
  };
  readonly instructions: { readonly fileNames: readonly string[] };
  readonly shell: { readonly defaultTimeoutS: number };
}

export const DEFAULT_CONFIG: KaiConfig = {
  gemini: { model: "gemini-3.8-flash", stateMode: "chained", serviceTier: "standard", thinkingSummaries: "none" },
  context: {
    enabledEpochs: true,
    seedTarget: 24_000,
    reserveOutput: 8_000,
    epochSoftLimit: 64_000,
    epochHardLimit: 160_000,
    ingressBatchMax: 12_000,
    preflightMarginMin: 0.1,
    contractMaxTokens: 3_000,
    instructionsMax: 6_000,
    repoMapMin: 2_000,
    repoMapMax: 6_000,
    repoMapColdStart: 8_000,
    inlineToolResultMax: 2_000,
    noticeMax: 300,
  },
  ledger: { enabled: true, partialMinFraction: 0.3, diffMaxFraction: 0.4, inlineStaleMaxTokens: 400 },
  shaper: { enabled: true, inlineMax: 2_000, shapedMax: 1_200, maxFailuresListed: 10, excerptFailures: 3 },
  readFile: { outlineThresholdLines: 300, lineNumbers: true },
  firewall: { mode: "enforce", budgetMsTs: 2_500, budgetMsPython: 3_500, dependents: 10 },
  governor: { mode: "adaptive" },
  repair: { enabled: true, maxAttemptsPerFailure: 3, maxAttemptsPerTask: 8, maxReplans: 2, maxRepairTokenShare: 0.4 },
  critic: { mode: "auto", maxRiskReviewTokens: 60_000, integrityReviewTokens: 20_000, integrityReview: true },
  tools: { exposure: "core_plus_packs" },
  verify: { backgroundT2: true, maxTargetedTests: 200, rerunsNow: 4, baselineRuns: 5, flakyWorseningDelta: 0.4, flakeHistoryDays: 30 },
  instructions: { fileNames: ["AGENTS.md", "KAI.md", "GEMINI.md"] },
  shell: { defaultTimeoutS: 120 },
};
