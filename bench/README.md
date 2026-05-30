# bench — `@peteqian/browser-agent` evaluation harness

A small, open, reproducible benchmark for comparing browser-automation agents on web tasks. Inspired by and structurally aligned with [`browser-use/benchmark`](https://github.com/browser-use/benchmark), with one explicit difference: **tasks are public and plaintext**. We trade contamination risk for the ability to ship task definitions inside this repo and let anyone reproduce results without a decryption key.

## What this measures

Each agent must complete a natural-language task in a real Chromium session. An LLM judge then reads the trajectory + final agent output + (optionally) the ground-truth answer and returns a binary `verdict` plus a structured `failure_reason`.

Score per agent = (tasks passed) / (tasks attempted).

Same scoring shape as `browser-use/benchmark`:

```jsonc
{
  "reasoning": "...",
  "verdict": true,
  "failure_reason": null,
  "impossible_task": false,
  "reached_captcha": false,
}
```

## Sources & citations

| Source                                                              | Used for                                                  | License                                   |
| ------------------------------------------------------------------- | --------------------------------------------------------- | ----------------------------------------- |
| [browser-use/benchmark](https://github.com/browser-use/benchmark)   | Harness shape, judge rubric, score schema, category split | no LICENSE — referenced as prior art      |
| [WebBench](https://github.com/web-bench/WebBench) (Xu et al., 2024) | Custom-task style inspiration                             | MIT                                       |
| [Mind2Web 2](https://github.com/OSU-NLP-Group/Mind2Web2)            | Multi-step web task style                                 | MIT                                       |
| [BrowseComp](https://github.com/openai/simple-evals)                | Question-answer-over-web style                            | MIT                                       |
| [GAIA](https://huggingface.co/datasets/gaia-benchmark/GAIA)         | Reasoning-over-web inspiration                            | not redistributed; only schema referenced |

We do **not** redistribute encrypted browser-use task content (`BU_Bench_V1.enc` / `Stealth_Bench_V1.enc`). Their README asks evaluators not to publish in plaintext to avoid LLM training contamination; we honor that by writing our own task set.

## Categories (10 tasks, V0)

Matches the 5-category split of BU Bench V1, scaled down:

| Category     | Count | Style                                                           |
| ------------ | ----- | --------------------------------------------------------------- |
| `custom`     | 2     | hand-written interaction                                        |
| `qa`         | 2     | extract a fact from a stable page                               |
| `multi-step` | 2     | navigate + read + report                                        |
| `form`       | 2     | fill + submit a non-destructive form                            |
| `stealth`    | 2     | reach content past common anti-bot barriers (public sites only) |

Tasks live in [`tasks/tasks.json`](./tasks/tasks.json). Each entry has `task_id`, `confirmed_task`, `category`, optional `answer`, and `max_steps`.

## Layout

```
bench/
  README.md                  # this file
  RESULTS.md                 # published numbers
  tasks/tasks.json           # benchmark V0 task set
  src/
    types.ts                 # task / run / judgement schemas
    harness.ts               # runs @peteqian/browser-agent on one task
    judge.ts                 # LLM judge (Claude transport by default)
    run.ts                   # CLI: bun run bench [--tasks N] [--agent peteqian|...] [--judge claude|openai]
    aggregate.ts             # collapse per-task results into a leaderboard row
  runners/
    browser-use.md           # how to run browser-use on the same tasks (Python)
  results/                   # per-run JSON, gitignored except *.published.json
```

## Running

From repo root:

```bash
bun run bench                     # full task set on our agent
bun run bench -- --tasks 3        # first 3 tasks only (smoke)
bun run bench -- --judge openai   # use OpenAI judge instead of Claude
```

For browser-use side-by-side, see [`runners/browser-use.md`](./runners/browser-use.md).

## Methodology — fair comparison rules

1. **Same tasks.** Both agents see the identical `confirmed_task` string.
2. **Same `max_steps`.** Default 25; override per-task.
3. **Same judge model.** `claude-sonnet-4-5` (or specify `--judge-model`).
4. **Cold browser per task.** No session reuse across tasks.
5. **No prompt-tuning per agent.** Whatever each agent ships with by default.
6. **Cite versions.** Every published result records `agent`, `agent_version`, `model`, `judge_model`, `commit_sha`, `run_started_at`.

## Costs

A 10-task run on our agent with `codex` default + `claude-sonnet-4-5` judge: roughly $1–3 in API spend and ~10 min wall time on a fast connection. Full 100-task replication of BU Bench V1 with all variants would track their published ~$35/100-task figure.

## Status

V0 — small task set, single agent (`peteqian/browser-agent`) wired into the harness, browser-use side-by-side stubbed via separate Python script (their existing `run_eval.py` already does the heavy lifting; we just normalize result shapes).
