import { execSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runPeteqianAgent } from "./harness";
import { judge, type JudgeOptions } from "./judge";
import { aggregate, formatLeaderboard } from "./aggregate";
import type { BenchTask, RunBundle, TaskRunRecord } from "./types";

interface CliArgs {
  tasksLimit?: number;
  judgeProvider?: JudgeOptions["provider"];
  judgeModel?: string;
  agentProvider?: string;
  agentModel?: string;
  outFile?: string;
  headful?: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--tasks") out.tasksLimit = Number(next);
    else if (a === "--judge") out.judgeProvider = next as never;
    else if (a === "--judge-model") out.judgeModel = next;
    else if (a === "--provider") out.agentProvider = next;
    else if (a === "--model") out.agentModel = next;
    else if (a === "--out") out.outFile = next;
    else if (a === "--headful") out.headful = true;
    if (a?.startsWith("--") && next && !next.startsWith("--") && a !== "--headful") i++;
  }
  return out;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const here = dirname(fileURLToPath(import.meta.url));
  const tasksPath = resolve(here, "../tasks/tasks.json");
  const allTasks = JSON.parse(await readFile(tasksPath, "utf8")) as BenchTask[];
  const tasks = args.tasksLimit ? allTasks.slice(0, args.tasksLimit) : allTasks;

  const commit = safeCommit();
  const agentVersion = await readPackageVersion();
  const bundle: RunBundle = {
    commit_sha: commit,
    run_started_at: new Date().toISOString(),
    agent: "@peteqian/browser-agent-sdk",
    agent_version: agentVersion,
    model: args.agentModel ?? "default",
    judge_model:
      args.judgeModel ?? (args.judgeProvider === "openai" ? "gpt-4.1-mini" : "claude-sonnet-4-5"),
    records: [],
  };

  console.log(
    `# bench run — ${tasks.length} task(s) — agent=${bundle.agent}@${bundle.agent_version}`,
  );

  for (const task of tasks) {
    console.log(`\n→ ${task.task_id} [${task.category}] ${task.confirmed_task.slice(0, 80)}...`);
    const started = new Date();
    const harness = await runPeteqianAgent(task, {
      provider: args.agentProvider,
      model: args.agentModel,
      headless: !args.headful,
    });
    let judgement;
    try {
      judgement = await judge(
        {
          task,
          agentSummary: harness.summary,
          agentReason: harness.reason,
          trajectory: harness.trajectory,
        },
        { provider: args.judgeProvider, model: args.judgeModel },
      );
    } catch (error) {
      judgement = {
        reasoning: `Judge call failed: ${error instanceof Error ? error.message : String(error)}`,
        verdict: false,
        failure_reason: "judge_error",
        impossible_task: false,
        reached_captcha: false,
      };
    }
    const record: TaskRunRecord = {
      task_id: task.task_id,
      category: task.category,
      agent: bundle.agent,
      agent_version: bundle.agent_version,
      model: bundle.model,
      judge_model: bundle.judge_model,
      started_at: started.toISOString(),
      ended_at: new Date().toISOString(),
      duration_ms: harness.duration_ms,
      steps: harness.steps,
      reason: harness.reason,
      summary: harness.summary,
      trajectory: harness.trajectory,
      judgement,
      error: harness.error,
    };
    bundle.records.push(record);
    console.log(
      `  reason=${record.reason} steps=${record.steps} duration=${(record.duration_ms / 1000).toFixed(1)}s verdict=${judgement.verdict}`,
    );
  }

  const row = aggregate(bundle);
  const board = formatLeaderboard([row]);
  console.log("\n" + board);

  const outDir = resolve(here, "../results");
  await mkdir(outDir, { recursive: true });
  const outFile = args.outFile
    ? resolve(here, "..", args.outFile)
    : resolve(outDir, `peteqian_${commit}_${Date.now()}.json`);
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

async function readPackageVersion(): Promise<string> {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await readFile(resolve(here, "../../package.json"), "utf8"));
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
