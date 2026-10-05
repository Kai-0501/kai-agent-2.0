# SWE-agent and mini-swe-agent

- **Repositories:**
  - [SWE-agent/SWE-agent](https://github.com/SWE-agent/SWE-agent) @ `3ea751c0` (2026-07-16)
  - [SWE-agent/mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent) @ `04d809ce` (2026-09-03)
- **License:** MIT (both)
- **Language/runtime:** Python. Docker or other sandboxes. LiteLLM for providers.
- **Studied as:** research-grade agent-computer interface (ACI) design, and the strongest
  minimal baseline.

## SWE-agent: the agent-computer interface

SWE-agent's thesis (the ACI paper, [arXiv:2405.15793](https://arxiv.org/abs/2405.15793)) is that
**interface design changes agent performance**. Tools are shell scripts bundled in
[`tools/`](https://github.com/SWE-agent/SWE-agent/tree/3ea751c087f32b16e039a2233dd6eefecef325d5/tools):
a windowed file viewer, capped search tools, several edit variants, `filemap`, `diff_state` and
`review_on_submit`.

**The lint-gated edit is the key mechanism.**
[`tools/windowed_edit_linting/bin/edit`](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/tools/windowed_edit_linting/bin/edit)
runs flake8 on the proposed result. If the edit **introduces new** syntax errors, it is **not
applied**, and the agent sees:

```
Your proposed edit has introduced new syntax error(s). …
This is how your edit would have looked if applied
…
This is the original code before your edit
…
Your changes have NOT been applied. Please fix your edit command and try again.
DO NOT re-run the same failed edit command. Running it again will lead to the same error.
```

Three things make this message effective, and Kai's Hallucination Firewall copies all three:
1. it reports only errors *introduced* by the edit (a delta against the original),
2. it shows the proposed and original code side by side, and
3. the rejected change never reaches disk.

**History processors**
([`sweagent/agent/history_processors.py`](https://github.com/SWE-agent/SWE-agent/blob/3ea751c087f32b16e039a2233dd6eefecef325d5/sweagent/agent/history_processors.py)):
`LastNObservations` elides old observations, `ClosedWindowHistoryProcessor` removes outdated
file-window views, and `CacheControlHistoryProcessor` places cache breakpoints. These are early
versions of observation masking.

**Review on submit** (`tools/review_on_submit_m`) asks the agent to review its diff before
submitting. It is a cheap self-check, but still a self-report.

## mini-swe-agent: the strongest argument against harness complexity

From the [README](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/README.md):

> "What if our agent was 100x simpler, and still worked nearly as well? … Just some 100 lines of
> python for the agent class … Scores >74% on the SWE-bench verified benchmark … Does not have
> any tools other than bash … Has a completely linear history … Executes actions with
> `subprocess.run` — every action is completely independent."

The SWE-agent README now recommends mini-swe-agent over SWE-agent:
*"It matches the performance of SWE-agent, while being much simpler."*

**What this means for Kai.** It is direct evidence that strong models need little scaffolding to
*solve* tasks. Kai's thesis is narrower: a harness can make a capable model **cheaper** (fewer
wasted tokens) and **more trustworthy** (verified, unmanipulated, without hallucinated symbols)
without lowering its solve rate. Every Kai mechanism must therefore beat a mini-swe-agent-style
baseline on *efficiency or correctness* in the benchmark, or be removed
([evaluation plan](../../evaluation/benchmark-plan.md)). mini-swe-agent with Gemini 3.8 Flash is
**baseline A**.

## Adopt

1. **Reject before write, using the error delta against the original, with original and
   proposed code shown together** ([firewall spec](../../specs/hallucination-firewall.md)).
2. **"Do not re-run the same failed command"** as an explicit message. Kai backs it up with
   fingerprint detection ([repair spec](../../specs/repair-replan-controller.md)).
3. **Windowed, capped observations by default.**
4. **mini-swe-agent as the baseline harness** for benchmarks: easy to run, reproducible, minimal.
5. **Stateless command execution** (`subprocess.run` per action) as the default shell model. A
   persistent shell session is optional and only for background processes.

## Reject

- **Bash as the only tool** for Kai itself. It cannot give Kai a read ledger, artifact spooling
  or pre-write validation, which are the mechanisms Kai exists to test.
- **Text-parsed actions.** Kai uses Gemini native function calling.
