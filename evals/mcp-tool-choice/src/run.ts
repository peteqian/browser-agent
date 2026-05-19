import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { aggregate, formatLeaderboard } from "./aggregate";
import { judge, type JudgeOptions } from "./judge";
import { planForTask, scorePlan, type PlanProviderOptions } from "./runner";
import type { BenchTask, RunBundle, TaskRunRecord } from "./types";

interface CliArgs {
  tasksLimit?: number;
  tasksFile?: string;
  judgeProvider?: JudgeOptions["provider"];
  judgeModel?: string;
  agentProvider?: PlanProviderOptions["provider"];
  agentModel?: string;
  outFile?: string;
  skipJudge?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--tasks") out.tasksLimit = Number(next);
    else if (a === "--tasks-file") out.tasksFile = next;
    else if (a === "--judge") out.judgeProvider = next as never;
    else if (a === "--judge-model") out.judgeModel = next;
    else if (a === "--provider") out.agentProvider = next as never;
    else if (a === "--model") out.agentModel = next;
    else if (a === "--out") out.outFile = next;
    else if (a === "--skip-judge") {
      out.skipJudge = true;
      continue;
    }
    if (a?.startsWith("--") && next && !next.startsWith("--") && a !== "--skip-judge") i++;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const tasksPath = args.tasksFile
    ? resolve(process.cwd(), args.tasksFile)
    : resolve(here, "../tasks/tasks.json");
  const allTasks = JSON.parse(await readFile(tasksPath, "utf8")) as BenchTask[];
  const tasks = args.tasksLimit ? allTasks.slice(0, args.tasksLimit) : allTasks;

  const commit = safeCommit();
  const bundle: RunBundle = {
    commit_sha: commit,
    run_started_at: new Date().toISOString(),
    agent: "@peteqian/browser-agent-evals-mcp-tool-choice",
    agent_version: "0.0.0",
    model: args.agentModel ?? "default",
    judge_model:
      args.judgeModel ?? (args.judgeProvider === "openai" ? "gpt-4.1-mini" : "claude-sonnet-4-5"),
    records: [],
  };

  console.log(`# mcp-tool-choice — ${tasks.length} task(s)`);

  for (const task of tasks) {
    console.log(`\n→ ${task.task_id} [${task.category}] ${task.confirmed_task.slice(0, 80)}...`);
    const started = new Date();
    const planResult = await planForTask(task, {
      provider: args.agentProvider,
      model: args.agentModel,
    });
    const heuristic = scorePlan(task, planResult.plan);
    let llmReasoning = "(judge skipped)";
    let llmVerdict = heuristic.verdict;
    if (!args.skipJudge) {
      const j = await judge(
        { task, plan: planResult.plan },
        { provider: args.judgeProvider, model: args.judgeModel },
      );
      llmReasoning = j.reasoning;
      // Combine: verdict must pass both the heuristic AND the LLM.
      llmVerdict = heuristic.verdict && j.verdict;
    }
    const ended = new Date();
    const record: TaskRunRecord = {
      task_id: task.task_id,
      category: task.category,
      agent: bundle.agent,
      agent_version: bundle.agent_version,
      model: bundle.model,
      judge_model: bundle.judge_model,
      started_at: started.toISOString(),
      ended_at: ended.toISOString(),
      duration_ms: ended.getTime() - started.getTime(),
      expected_tools: task.expected_tools,
      forbidden_tools: task.forbidden_tools ?? [],
      toolChoiceResult: {
        ...heuristic,
        verdict: llmVerdict,
        reasoning: `${heuristic.reasoning} | judge: ${llmReasoning}`,
      },
      rawPlan: planResult.raw,
      error: planResult.error,
    };
    bundle.records.push(record);
    console.log(
      `  called=${planResult.plan.length} f1=${heuristic.f1.toFixed(2)} verdict=${llmVerdict}`,
    );
  }

  const row = aggregate(bundle);
  const board = formatLeaderboard([row]);
  console.log("\n" + board);

  const outDir = resolve(here, "../results");
  await mkdir(outDir, { recursive: true });
  const outFile = args.outFile
    ? resolve(process.cwd(), args.outFile)
    : resolve(outDir, `tool-choice_${commit}_${Date.now()}.json`);
  await writeFile(outFile, JSON.stringify({ bundle, summary: row }, null, 2));
  console.log(`\nwrote ${outFile}`);
}

function safeCommit(): string {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return "unknown";
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
