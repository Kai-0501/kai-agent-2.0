/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * @kai/core: the domain of Kai Agent. It depends only on @kai/protocol and on the interfaces
 * declared here. Implementations of code intelligence (@kai/code-intel), provider adapters
 * (@kai/provider-gemini, @kai/provider-openai, @kai/provider-compatible), harness profiles
 * (@kai/profiles, planned) and the research browser (@kai/research-chrome) are wired in by the
 * composition root (@kai/runtime). Core never imports them (AGENTS.md invariant 6).
 *
 * Map of modules to specs:
 *   provider.ts   → docs/adr/0011, docs/adr/0018, docs/specs/gemini-provider.md, openai-responses-provider.md, compatible-endpoints.md
 *   credentials.ts → docs/specs/credentials.md, docs/specs/chatgpt-sign-in.md
 *   profiles.ts   → docs/specs/harness-profiles.md
 *   learning.ts   → docs/specs/learning-service.md
 *   research.ts   → docs/specs/chrome-research.md
 *   events.ts     → docs/specs/event-model.md
 *   contract.ts   → docs/specs/task-contract.md
 *   context.ts    → docs/specs/context-compiler.md
 *   ledger.ts     → docs/specs/read-ledger.md
 *   artifacts.ts  → docs/specs/artifact-store.md
 *   tools.ts      → docs/specs/tool-surface.md
 *   patch.ts      → docs/specs/patch-engine.md
 *   firewall.ts   → docs/specs/hallucination-firewall.md
 *   codeintel.ts  → docs/specs/repo-index.md, docs/specs/api-reality-checker.md
 *   verify.ts     → docs/specs/verification-engine.md
 *   integrity.ts  → docs/specs/test-integrity-guard.md
 *   repair.ts     → docs/specs/repair-replan-controller.md
 *   critic.ts     → docs/specs/critic.md
 *   governor.ts   → docs/specs/reasoning-governor.md
 *   telemetry.ts  → docs/specs/telemetry.md
 *   config.ts     → docs/specs/configuration.md; defaults for all of the above
 */
export type * from "./provider.js";
export type * from "./events.js";
export type * from "./contract.js";
export type * from "./context.js";
export type * from "./ledger.js";
export type * from "./artifacts.js";
export type * from "./tools.js";
export type * from "./patch.js";
export type * from "./firewall.js";
export type * from "./codeintel.js";
export type * from "./verify.js";
export type * from "./integrity.js";
export type * from "./repair.js";
export type * from "./critic.js";
export type * from "./governor.js";
export type * from "./telemetry.js";
export type * from "./credentials.js";
export type * from "./profiles.js";
export type * from "./learning.js";
export type * from "./research.js";
export type { ConfigMigration, CredentialSource, EndpointConfig, KaiConfig, KaiConfigV1, RouteConfig } from "./config.js";
export { DEFAULT_CONFIG } from "./config.js";
