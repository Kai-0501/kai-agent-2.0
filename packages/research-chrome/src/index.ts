/**
 * SCAFFOLD: types only. Not an implementation.
 *
 * @kai/research-chrome: the research worker process. Discovers and validates the user's installed
 * Google Chrome, launches it with an APP-OWNED profile through playwright-core's persistent
 * context (Playwright adds --user-data-dir and --remote-debugging-pipe; no TCP debugging port),
 * routes all traffic through a loopback filtering proxy, parses Google SERPs semantically and
 * extracts readable page text. Implements the core BrowserPort; core never imports this package.
 * Spec: docs/specs/chrome-research.md · Decision: docs/adr/0021 · Research: docs/research/extension-2026-10.md §4
 */
import type { BrowserPort, ResearchOutcome, ResultKind } from "@kai/core";
import type { ChromeStatus, LineRange, ResearchOpId } from "@kai/protocol";

export interface ChromeCandidate {
  readonly path: string; // .app bundle
  readonly source: "user_selected" | "applications" | "user_applications" | "spotlight";
}

export interface ChromeValidation {
  readonly bundleId: string; // must be "com.google.Chrome" (Beta/Canary only if user-selected)
  readonly executable: string; // Contents/MacOS/Google Chrome
  readonly version: string; // CFBundleShortVersionString
  readonly signature: { readonly valid: boolean; readonly teamId?: string }; // Team ID check pending O10
  readonly status: ChromeStatus;
}

/** Launch plan; never contains Chrome's default user data directory. */
export interface BrowserLaunchPlan {
  readonly executablePath: string;
  readonly userDataDir: string; // <KAI_HOME>/browser/profile-v1
  readonly headless: boolean; // true except during a human handoff
  readonly proxy: { readonly server: `http://127.0.0.1:${number}`; readonly username: string; readonly password: string }; // per launch
  readonly args: readonly string[]; // --proxy-bypass-list=<-loopback>, --disable-quic, --force-webrtc-ip-handling-policy=disable_non_proxied_udp, --no-first-run, --no-default-browser-check
  readonly acceptDownloads: false;
  readonly serviceWorkers: "block";
  readonly locale: string;
  readonly timeoutMs: number; // 20_000
}

export interface ProfileLock {
  readonly pid: number;
  readonly startTime: string;
  readonly runtimeInstanceId: string;
}

/** Filtering proxy policy: resolve, refuse any denied address, connect to the checked address. */
export interface ProxyPolicy {
  readonly allowedPorts: readonly number[]; // [80, 443]
  readonly deniedRanges: readonly string[]; // 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16, 100.64/10, 0/8, ::1, fc00::/7, fe80::/10
  readonly blockedDomains: readonly string[];
}

export type SerpParse =
  | {
      readonly outcome: Extract<ResearchOutcome, { outcome: "ok" }>;
      readonly results: readonly { readonly rank: number; readonly kind: ResultKind; readonly title: string; readonly url: string; readonly snippet?: string; readonly dateText?: string }[];
    }
  | { readonly outcome: Exclude<ResearchOutcome, { outcome: "ok" }> };

/** Engine-specific SERP adapter; google_web@1 parses semantically (landmarks, headings, labels). */
export interface SearchEngineAdapter {
  readonly id: "google_web";
  readonly version: string;
  readonly locales: readonly string[]; // label sets + fixtures: ["en", "de", "ja"]
  buildUrl(query: string, opts: { readonly locale: string; readonly site?: string; readonly freshness?: "any" | "year" | "month" | "week" }): string;
  /** Receives the serialized DOM; never runs code in the page context. */
  parse(html: string, finalUrl: string, locale: string): SerpParse;
}

export interface ExtractionResult {
  readonly method: "readability" | "aria" | "pdfjs" | "none";
  readonly text: string; // sanitized (zero-width/bidi removed, Kai tags escaped), redacted
  readonly sections: readonly { readonly path: string; readonly range: LineRange }[];
  readonly warnings: readonly string[];
}

/** Typed IPC between the runtime's ResearchService and this worker (Zod-validated both ways). */
export type WorkerRequest =
  | { readonly op: "status" }
  | { readonly op: "search"; readonly opId: ResearchOpId; readonly query: string; readonly site?: string; readonly freshness?: "any" | "year" | "month" | "week"; readonly locale: string }
  | { readonly op: "open"; readonly opId: ResearchOpId; readonly url: string; readonly expand: boolean }
  | { readonly op: "handoff"; readonly opId: ResearchOpId; readonly action: "open" | "skip" }
  | { readonly op: "shutdown"; readonly deadlineMs: number };

export type WorkerEvent =
  | { readonly event: "status"; readonly status: ChromeStatus }
  | { readonly event: "handoff_needed"; readonly opId: ResearchOpId; readonly kind: "consent_required" | "captcha" | "sign_in_wall" }
  | { readonly event: "browser_disconnected" };

export interface ResearchWorker extends BrowserPort {
  locate(): Promise<readonly ChromeCandidate[]>;
  validate(candidate: ChromeCandidate): Promise<ChromeValidation>;
  /** Removes stale locks; terminates only a Chrome whose argv has --user-data-dir=<our profile> exactly. */
  cleanupOrphans(): Promise<{ readonly terminated: readonly number[] }>;
}
