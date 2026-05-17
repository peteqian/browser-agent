import { readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";

import { judge } from "./judge";
import type { BenchTask, RunBundle, TaskRunRecord } from "./types";

interface RawResult {
  task_id: string;
  category: BenchTask["category"];
  duration_ms: number;
  steps: number;
  summary: string;
  reason: string;
  error?: string | null;
}

function getArg(name: string, fallback?: string): string {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx >= 0 && process.argv[idx + 1]) return process.argv[idx + 1] as string;
  if (fallback !== undefined) return fallback;
  throw new Error(`missing --${name}`);
}

const tasksPath = getArg("tasks", "bench/tasks/tasks.json");
const rawPath = getArg("input");
const outPath = getArg("out");
const agent = getArg("agent");
const agentVersion = getArg("agent-version");
const model = getArg("model");
const judgeModel = getArg("judge-model", "claude-cli");

const tasks: BenchTask[] = JSON.parse(await readFile(tasksPath, "utf8"));
const raws: RawResult[] = JSON.parse(await readFile(rawPath, "utf8"));
const taskMap = new Map(tasks.map((t) => [t.task_id, t]));

const records: TaskRunRecord[] = [];
for (const r of raws) {
  const task = taskMap.get(r.task_id);
  if (!task) {
    console.error(`[judge-external] unknown task_id ${r.task_id}, skipping`);
    continue;
  }
  console.error(`[judge-external] judging ${r.task_id} ...`);
  const judgement = await judge(
    { task, agentSummary: r.summary, agentReason: r.reason, trajectory: r.summary },
    {
      provider: judgeModel === "claude-cli" ? "claude-cli" : undefined,
      model: judgeModel === "claude-cli" ? undefined : judgeModel,
    },
  );
  const now = new Date().toISOString();
  records.push({
    task_id: r.task_id,
    category: r.category,
    agent,
    agent_version: agentVersion,
    model,
    judge_model: judgeModel,
    started_at: now,
    ended_at: now,
    duration_ms: r.duration_ms,
    steps: r.steps,
    reason: r.reason,
    summary: r.summary,
    judgement,
    error: r.error ?? undefined,
  });
  console.error(`  -> verdict=${judgement.verdict} captcha=${judgement.reached_captcha}`);
}

let commit = "unknown";
try {
  commit = execSync("git rev-parse HEAD", { encoding: "utf8" }).trim();
} catch {
  // not in a git repo
}

const bundle: RunBundle = {
  commit_sha: commit,
  run_started_at: new Date().toISOString(),
  agent,
  agent_version: agentVersion,
  model,
  judge_model: judgeModel,
  records,
};

await writeFile(outPath, JSON.stringify(bundle, null, 2));
const passed = records.filter((r) => r.judgement.verdict).length;
console.error(`[judge-external] wrote ${outPath} — ${passed}/${records.length} passed`);
