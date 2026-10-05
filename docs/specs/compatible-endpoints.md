# Spec: OpenAI-compatible endpoints

- Package: `packages/provider-compatible`
- Decision: [ADR-0019](../adr/0019-openai-compatible-endpoints.md)
- Collaborators: [credentials](credentials.md), [harness profiles](harness-profiles.md) (`generic`), [Context Compiler](context-compiler.md), [configuration](configuration.md), [telemetry](telemetry.md)

## Responsibility

Connect Kai to user-configured hosted or local model servers that speak an OpenAI-compatible
dialect; establish what each endpoint **actually** supports through bounded probes; translate
canonical requests and streams safely; and report unsupported capabilities honestly.

**Not responsible for:** model-facing behaviour (the `generic` profile), deciding that an
endpoint is "good enough" for a task (the user chooses; Kai reports the snapshot and limits).

## Configuration

Endpoints live in the user config (`endpoints` map; [configuration](configuration.md)). A
workspace config cannot add endpoints or credentials.

```jsonc
{
  "endpoints": {
    "lmstudio-local": {
      "label": "LM Studio (local)",
      "baseUrl": "http://127.0.0.1:1234/v1",
      "model": "qwen3-coder-30b-a3b-instruct",
      "dialect": "chat_completions",             // "chat_completions" | "responses" (only if probed)
      "auth": { "kind": "none" },                 // intentional no-auth: allowed only for loopback/lan
      "network": { "scope": "loopback" },         // "public" | "loopback" | "lan"
      "privacy": "local_only",                     // "local_only" | "cloud"
      "limits": { "contextTokens": 32768, "maxOutputTokens": 4096 },
      "timeouts": { "connectMs": 5000, "firstByteMs": 120000, "idleMs": 60000, "totalMs": 900000 },
      "capabilityOverrides": { "parallelToolCalls": "unsupported" },
      "providerOptions": { "top_k": 20, "repeat_penalty": 1.05 }
    },
    "openrouter": {
      "label": "OpenRouter",
      "baseUrl": "https://openrouter.ai/api/v1",
      "model": "<provider>/<model>",
      "dialect": "chat_completions",
      "auth": { "kind": "bearer", "credentialRef": "cred_K4M2…" },
      "network": { "scope": "public" },
      "privacy": "cloud"
    }
  }
}
```

| Field | Rule |
|---|---|
| `id` (map key) | `^[a-z0-9][a-z0-9-]{0,39}$`; route ID becomes `compat:<id>` |
| `baseUrl` | Parsed with WHATWG `URL`; no userinfo, query or fragment; trailing `/` removed; must not already end in `/chat/completions` or `/responses` (the endpoint doctor suggests the fix); `https:` required unless `network.scope` is `loopback` or `lan` |
| Path joining | `new URL(base.pathname + "/chat/completions", base.origin)`; never string concatenation of user input into hosts |
| `auth.kind` | `bearer` (`Authorization: Bearer`), `header` (name from the allowlist `api-key`, `x-api-key`), or `none` (only with `loopback`/`lan`). Secrets come from `credentialRef` (Keychain) or `env:<VAR>`, never inline |
| `network.scope` | `loopback`: resolved address must be `127.0.0.0/8` or `::1`. `lan`: RFC 1918, `fc00::/7` or link-local. `public`: resolved address must **not** be any of those. Checked at every connection from the resolved address actually used (no TOCTOU between check and connect: the adapter connects to the IP it checked, with SNI and `Host` set to the hostname) |
| `privacy` | `local_only` endpoints are never used for anything a `cloud` policy forbids, and tasks on them produce `local_only` learning data |
| `limits` | User-declared; probes may lower but never raise them; absent → `/models` metadata if present → conservative 8k context / 1k output with a doctor warning |
| `providerOptions` | Allowlist: `top_k`, `min_p`, `repeat_penalty`, `seed`, `stop` (array of strings), `reasoning_effort` (string), `chat_template_kwargs` (object of scalars, depth 1). Any other key is a config validation error. Values are JSON scalars; no templates, no functions |
| TLS | System trust store; optional `tls.caFile` (PEM path, read once); certificate verification cannot be disabled |
| Redirects | Not followed by default. A 307/308 to the **same origin** is followed once. Any cross-origin redirect is an error (`redirect_refused`); credentials are never sent to another origin |

**Arbitrary configuration never becomes code:** there is no package-name field, no plugin path,
no script hook and no template evaluation. The adapter is fixed code; the config is data
validated by Zod.

## Dialects

- **`chat_completions`** (baseline): `POST {base}/chat/completions`, `messages`, `tools`
  (`type: "function"`), `tool_choice`, `stream: true` with `stream_options.include_usage` when
  probed as supported.
- **`responses`**: allowed only after probes P1–P6 pass on the Responses shape; then the
  adapter uses the [Responses mapping](openai-responses-provider.md#mapping-canonical--responses-input-items)
  with an endpoint allowlist (no OpenAI-specific fields unless probed).

## Capability probes

Bounded, disclosed, cached. Run from the endpoint doctor, at first use of an endpoint (after the
user confirms the disclosure for `public` endpoints), and after an invalidation.

| Probe | Request | Establishes | Billable |
|---|---|---|---|
| P0 | `GET {base}/models` | reachability, auth, model listed, metadata limits | no |
| P1 | 1 non-streaming chat, ≤ 16 output tokens | basic generation, `usage` presence | yes |
| P2 | Same, streaming | SSE framing, `[DONE]`, usage in stream | yes |
| P3 | Forced single tool call (`tool_choice` named, then `"required"`, then `"auto"` with an instruction) | tool calling and which `tool_choice` forms work | yes |
| P4 | Request that invites two independent calls | parallel tool calls, fragment interleaving by `index` | yes |
| P5 | Tool result round trip (`role: "tool"`, `tool_call_id`) and a follow-up | result pairing, finish reasons | yes |
| P6 | `system` vs `developer` role acceptance | role mapping | yes |
| P7 | A nested-object argument schema (depth 2) | schema handling for `update_plan` | yes |
| P8 | Reasoning fields in output (`reasoning_content`, `reasoning`) and whether omitting them on replay breaks the next turn | reasoning replay requirement | yes |
| P9 | P3 and P5 repeated 3× | tool-call **reliability** (3/3 valid calls required) | yes |

Total cost is disclosed before running (about 12 requests, ≈ 3k tokens). Probes run with a
30 s timeout each and stop at the first transport failure.

```ts
interface CompatibleCapabilitySnapshot extends CapabilitySnapshot {
  provider: "compatible";
  endpointId: EndpointId;
  configRevision: ContentHash;          // hash of baseUrl, model, dialect, auth.kind, providerOptions, limits
  adapterVersion: string;
  serverHint?: string;                  // from the Server header or /models; display only, never a capability signal
  features: {
    streaming: Support; usageReported: Support; streamUsage: Support;
    toolCalling: Support; toolChoiceForms: ("named" | "required" | "auto" | "none")[];
    parallelToolCalls: Support; developerRole: Support; nestedSchemas: Support;
    reasoningReplayRequired: Support; toolReliability: { valid: number; attempts: number };
  };
  mode: "agent" | "chat_only";          // chat_only if toolCalling != supported or reliability < 3/3 or usable context < 10k
}
```

- **Tri-state:** each feature is `supported`, `unsupported` or `unknown`, with provenance
  (`probe:P3`, `override:user`, `metadata`). A user override is shown as an override in every
  surface and recorded in the snapshot.
- **Cache key:** `(endpointId, configRevision, adapterVersion)`; TTL 7 days. Any change to the
  key invalidates the snapshot and requires a re-probe before the next agent task.
- **Never inferred from names:** model names, server vendors, provider nationality and
  parameter counts are not capability signals.

## Request and stream handling

- **Roles:** system prompt as `system`, or as `developer` if P6 showed `system` is rejected.
  Harness notices as `user` messages with the `<kai_notice>` wrapper.
- **Tool calls:** stream fragments are accumulated by `index` (and `id` when present). A call is
  complete only after the stream's `finish_reason` arrives. Then: JSON-parse the arguments,
  validate the name against the rendered tool set, validate the arguments with the tool's Zod
  schema. Any failure → **not executed**; the model gets
  `ERROR: invalid tool call (<reason>); nothing was executed.` once. Two consecutive invalid calls
  on the same tool trigger rule D1-style handling ([repair](repair-replan-controller.md)).
  Missing call IDs are synthesized (`call_kai_<n>`) and stored.
- **Finish reasons:** `tool_calls` and `stop` are normal; `length` → output limit notice and
  one retry with a smaller edit instruction; `content_filter` → `model_failed`; unknown values
  are logged and treated as `stop` only if no tool call is pending.
- **Malformed SSE** (bad JSON line, missing `[DONE]` with an open call) → `stream_interrupted`;
  nothing executes; retry once.
- **Usage:** recorded only when reported; otherwise `null` (unknown). Kai's estimates are
  labelled estimated. Tokenizer is "unknown" until reported usage has calibrated the estimator
  for ≥ 5 turns.
- **Reasoning content:** stored as a `replay_native` item tagged with the endpoint; replayed only
  if P8 showed it is required; never sent to any other endpoint or provider.
- **Context limits:** a 400 that mentions context length → the preflight recalibrates (×1.2) and
  starts a new epoch; a second occurrence lowers `limits.contextTokens` in the snapshot by 10%.

## Limited mode and the text-tool fallback

If `mode = chat_only`, tasks on the endpoint can explain, plan and answer questions (no tools
declared), but **autonomous editing is rejected** with a clear reason in the task view and the
doctor. Kai never parses free prose as commands.

`kai-text-tools/1` is an **experimental, off-by-default** fallback
(`endpoints.<id>.experimentalTextTools: true`):

- the model must answer with exactly one fenced block tagged `kai-call` containing one JSON
  object `{"tool": "...", "args": {...}}`; any other text outside the block is ignored;
- only read-only tools and `update_plan` are allowed; edits stay disabled until the benchmark
  shows ≥ 95% valid calls over ≥ 200 probe calls for that endpoint and model, and the user then
  enables `experimentalTextToolEdits`; even then edits go through the Patch Engine unchanged;
- a block that fails parsing or validation is not executed and counts against the reliability
  figure shown in the doctor.

## Endpoint doctor

`kai endpoint doctor <id>` and the app's endpoint screen show: normalized URL and origin, scope
check result (resolved address class), auth kind (never the secret), probe table with
latencies, effective context and output limits with their source, mode (`agent` or
`chat_only`) with reasons, last error, and cache age. It can re-probe, clear overrides or edit
the config.

## Provider switch

A change of endpoint config or a switch to/from an endpoint mid-project happens at a safe
boundary ([context compiler](context-compiler.md#provider-and-route-switches)): durable state is
kept; a new epoch seed is compiled with the new profile and budgets; `replay_native` items from
the old endpoint are dropped; a `local_only` project cannot be switched to a `cloud` route
without the user's explicit confirmation that names the privacy change.

## Telemetry

Per endpoint: probe results history, request latency (TTFB, total), invalid tool calls by reason,
finish reasons, usage reported share, estimator calibration error, chat-only rejections.

## Contract test matrix (live, gated `test:contract:compat`)

| Target | Dialect | Kind | Pinned when recorded |
|---|---|---|---|
| OpenRouter | `chat_completions` | hosted | API date and model ID recorded in the suite |
| LM Studio | `chat_completions` | local (`loopback`) | app version, model file and quantization |
| llama.cpp `llama-server` | `chat_completions` | local (`loopback`) | build number (`--version`), model file, chat template |

The suite records exact versions on first run and fails if they drift without an update. It is
never reported as passing without those servers available.

## Acceptance tests (offline, fake servers)

1. **Small context, no reasoning control, valid tools:** a 32k fake endpoint with no effort
   control and no usage completes the fixture task (`fixtures/ts-small`) with the `generic`
   profile; every request passes preflight; effort recorded `uncontrolled`; usage `null`.
2. **Malformed and incomplete calls never execute:** fragments that never finish, invalid JSON,
   unknown tool names and schema-invalid arguments each give an error result and zero tool
   executions (asserted by the registry's execution counter).
3. **Fragment assembly:** interleaved fragments for two calls (by `index`) assemble into two
   valid calls.
4. **Missing usage stays unknown:** totals show `unknown` counts; no zero is written.
5. **Probe invalidation:** changing `model` or `baseUrl` changes `configRevision`; the next task
   re-probes; a replay item from the old config is not sent.
6. **No cross-provider replay:** switching a task from `compat:a` to `openai.api_key` drops
   `replay_native` items from `compat:a` (request body asserted).
7. **Scope enforcement:** a `public` endpoint whose hostname resolves to `127.0.0.1` is refused;
   a `loopback` endpoint resolving to a public address is refused.
8. **Redirects:** a cross-origin 302 is refused and the second origin receives no credentials.
9. **Config is data:** unknown `providerOptions` keys and inline secrets fail validation with a
   clear message.
10. **Chat-only:** an endpoint failing P9 runs a task in `chat_only`; an edit request is
    rejected with the reason; no prose is parsed as a command.
