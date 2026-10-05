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
  readonly critic: { readonly mode: "auto" | "always" | "off"; readonly maxTokensPerTask: number };
  readonly tools: { readonly exposure: "core_plus_packs" | "all" };
  readonly verify: { readonly backgroundT2: boolean; readonly flakyReruns: number; readonly maxTargetedTests: number };
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
  critic: { mode: "auto", maxTokensPerTask: 60_000 },
  tools: { exposure: "core_plus_packs" },
  verify: { backgroundT2: true, flakyReruns: 2, maxTargetedTests: 200 },
  shell: { defaultTimeoutS: 120 },
};
