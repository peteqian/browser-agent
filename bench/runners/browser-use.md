# Running `browser-use` against the same task set

This is the parallel runner that lets us publish apples-to-apples numbers.

`browser-use` is Python. We do **not** vendor it. You install it in a sibling venv, point it at our `tasks/tasks.json`, and dump per-task results into the same JSON schema this harness uses.

## 1. Install

```bash
# Outside this repo — sibling directory
python3 -m venv .venv
source .venv/bin/activate
pip install browser-use==0.11.7 anthropic openai
playwright install chromium
```

## 2. Translate our task file

`tasks/tasks.json` already uses the same field names browser-use expects:

- `task_id`, `confirmed_task`, `category`, `answer` (optional), `max_steps`

Their `BU_Bench_V1` decrypted file uses the same shape, so their `run_eval.py` works as-is once you replace the decrypted task list.

## 3. Minimal runner

```python
# bench-browser-use.py
import json, time, os, asyncio
from pathlib import Path
from browser_use import Agent
from browser_use.llm import ChatAnthropic

TASKS = json.loads(Path("bench/tasks/tasks.json").read_text())

async def run_one(task):
    started = time.time()
    agent = Agent(
        task=task["confirmed_task"],
        llm=ChatAnthropic(model="claude-sonnet-4-5"),
        max_steps=task.get("max_steps", 25),
    )
    history = await agent.run()
    return {
        "task_id": task["task_id"],
        "category": task["category"],
        "duration_ms": int((time.time() - started) * 1000),
        "steps": len(history.history) if hasattr(history, "history") else 0,
        "summary": history.final_result() if hasattr(history, "final_result") else str(history),
        "reason": "completed" if history.is_done() else "max_steps",
    }

async def main():
    out = []
    for t in TASKS:
        try:
            out.append(await run_one(t))
        except Exception as e:
            out.append({"task_id": t["task_id"], "error": str(e), "reason": "harness_error"})
    Path("bench/results/browser-use.raw.json").write_text(json.dumps(out, indent=2))

asyncio.run(main())
```

## 4. Score with the same judge

Pipe the raw results through our TS judge so the rubric is identical:

```bash
bun run bench:judge -- --input bench/results/browser-use.raw.json \
  --agent browser-use --agent-version 0.11.7 --model claude-sonnet-4-5
```

(The `bench:judge` script is a thin wrapper over `bench/src/judge.ts` — see [`../src/judge.ts`](../src/judge.ts).)

## Important — fair comparison

- **Same judge model.** Use `claude-sonnet-4-5` on both sides, or `gpt-4.1-mini` on both. Mixing biases results.
- **Same `max_steps`** (already enforced because both runners read the same JSON).
- **Cold browser per task.** browser-use defaults to a fresh launch; our harness does the same.
- **No agent-specific prompt tuning.** Use stock prompts on both sides.
- **Record versions.** browser-use 0.11.7 ≠ 0.12.6. Pin and cite.

## Why not vendor it

1. Their license situation is unsettled (no LICENSE file in their repo as of this writing).
2. Mixing Python + TS in one workspace explodes CI time.
3. Their package ships its own browser launcher and Playwright dep tree.

Keep it next door, keep the task file the source of truth, and let the judge produce the comparable column.
