# Third-party notices

Kai Agent's own code and documentation are licensed under the
[Apache License 2.0](LICENSE). Everything listed below belongs to its respective authors and
remains under its own license; Kai's licence does not apply to it.

Kai is implemented from scratch. As of this revision the repository contains **no vendored or
copied third-party source code** and ships no runtime dependencies. When a runtime library,
grammar or other asset is bundled, its licence is recorded here in the same change
([AGENTS.md](AGENTS.md#licensing-rules)).

## Development dependencies

Installed by `pnpm i` from the npm registry for type-checking only. They are not redistributed in
this repository.

| Package | Version (lockfile) | License | Source |
|---|---|---|---|
| `typescript` (and its `@typescript/typescript-<platform>` binaries) | 7.0.2 | Apache-2.0 | [microsoft/TypeScript](https://github.com/microsoft/TypeScript) |
| `@types/node` | 24.19.1 | MIT | [DefinitelyTyped/DefinitelyTyped](https://github.com/DefinitelyTyped/DefinitelyTyped) |
| `undici-types` (transitive, via `@types/node`) | 7.24.6 | MIT | [nodejs/undici](https://github.com/nodejs/undici) |

## Projects studied for the design

The research in [docs/research/](docs/research/) studied these projects at pinned commits
(see the [source snapshot](docs/research/README.md#source-snapshot)). They informed the
architecture as **ideas only**; no code from them is included. Credit and thanks to their
authors and contributors.

| Project | Repository | License |
|---|---|---|
| T3 Code | [pingdotgg/t3code](https://github.com/pingdotgg/t3code) | MIT |
| Pi | [earendil-works/pi](https://github.com/earendil-works/pi) | MIT |
| Aider | [Aider-AI/aider](https://github.com/Aider-AI/aider) | Apache-2.0 |
| OpenCode | [anomalyco/opencode](https://github.com/anomalyco/opencode) | MIT |
| Cline | [cline/cline](https://github.com/cline/cline) | Apache-2.0 |
| OpenHands | [OpenHands/OpenHands](https://github.com/OpenHands/OpenHands) | MIT |
| OpenHands Software Agent SDK | [OpenHands/software-agent-sdk](https://github.com/OpenHands/software-agent-sdk) | MIT |
| Goose | [block/goose](https://github.com/block/goose) | Apache-2.0 |
| SWE-agent | [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) | MIT |
| mini-swe-agent | [SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) | MIT |
| Gemini CLI | [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | Apache-2.0 |
| Codex CLI | [openai/codex](https://github.com/openai/codex) | Apache-2.0 |
| Serena | [oraios/serena](https://github.com/oraios/serena) | GPL-3.0-or-later (application) / MIT (SolidLSP) |
| Hermes Agent | [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent) | MIT |
| Google Gen AI SDK for JavaScript | [googleapis/js-genai](https://github.com/googleapis/js-genai) | Apache-2.0 |
| Google Gen AI SDK for Python | [googleapis/python-genai](https://github.com/googleapis/python-genai) | Apache-2.0 |
| Gemini API Cookbook | [google-gemini/cookbook](https://github.com/google-gemini/cookbook) | Apache-2.0 |
| Playwright | [microsoft/playwright](https://github.com/microsoft/playwright) | Apache-2.0 |

Serena's application code is GPL-3.0-or-later and must never be copied into Kai
([AGENTS.md](AGENTS.md#licensing-rules)).

## Quoted excerpts

The research notes contain a few short, attributed excerpts for commentary. Each is linked to its
source at a pinned commit and remains under its project's license:

- OpenHands Software Agent SDK (MIT, Copyright (c) 2026 OpenHands contributors):
  [docs/research/upstream/openhands.md](docs/research/upstream/openhands.md)
- SWE-agent's edit-linter message (MIT, Copyright (c) 2024 John Yang, Carlos E. Jimenez,
  Alexander Wettig, Shunyu Yao, Karthik Narasimhan, Ofir Press) and the mini-swe-agent README
  (MIT, Copyright (c) 2025 Kilian A. Lieret and Carlos E. Jimenez):
  [docs/research/upstream/swe-agent.md](docs/research/upstream/swe-agent.md)

API behaviour described in [docs/research/gemini-api.md](docs/research/gemini-api.md) and
[docs/research/extension-2026-10.md](docs/research/extension-2026-10.md) is summarised from
public vendor documentation, which is linked in place and remains under its publishers' terms.

## Trademarks

Gemini and Google Chrome are trademarks of Google LLC. OpenAI, ChatGPT and Codex are trademarks
of OpenAI. macOS is a trademark of Apple Inc. Other product names belong to their owners. They are
used only to describe compatibility; Kai Agent is not affiliated with or endorsed by them.
