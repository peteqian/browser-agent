# mcp-tool-choice evals

Evals harness grading whether an LLM picks the correct MCP tools for a
given browser task. Unlike `packages/sdk/bench/` (which grades end-to-end
task success), this harness scores **tool selection only**.

## How it works

1. For each task, the planner LLM is shown the task plus the catalog of
   real MCP tools registered in `packages/cli/src/mcp/tools/*.ts` and
   asked to return a JSON `{ "plan": ["tool_a", "tool_b", ...] }`.
2. The plan is scored against the task's `expected_tools` /
   `forbidden_tools` using a heuristic (precision, recall, F1, forbidden
   hits, min/max call bounds, unknown-tool detection).
3. An optional LLM judge then double-checks ordering and intent. Final
   verdict requires both the heuristic and the judge to pass.

This avoids launching Chrome — the agent just plans.

## Run

```
bun --cwd evals/mcp-tool-choice install
bun --cwd evals/mcp-tool-choice run start -- --tasks 3
```

CLI flags:

- `--tasks N` — limit task count
- `--tasks-file path.json` — override task list
- `--provider anthropic|openai|claude-cli` — planner provider
- `--model NAME` — planner model
- `--judge anthropic|openai|claude-cli` — judge provider
- `--judge-model NAME` — judge model
- `--skip-judge` — heuristic only
- `--out FILE` — output JSON path

Providers fall back: `ANTHROPIC_API_KEY` → anthropic, else
`OPENAI_API_KEY` → openai, else `claude-cli`.

## Task schema

```ts
{
  task_id: string;
  category: "auth" | "navigation" | "extraction" | "interaction"
          | "session" | "multi-step" | "negative";
  confirmed_task: string;
  expected_tools: string[];     // ground-truth set
  forbidden_tools?: string[];   // any of these in the plan => fail
  min_calls?: number;
  max_calls?: number;
}
```

## Files

- `src/types.ts` — task + result types
- `src/tools-catalog.ts` — universe of MCP tools (kept in sync with
  `packages/cli/src/mcp/tools/`)
- `src/runner.ts` — planner LLM + heuristic scorer
- `src/judge.ts` — LLM judge (anthropic / openai / claude-cli)
- `src/aggregate.ts` — leaderboard math
- `src/run.ts` — CLI entry
- `tasks/tasks.json` — 13 scenarios
