import { spawn } from "node:child_process";

import type { BenchTask, PlanResult, ToolChoiceResult } from "./types";
import { formatCatalog, TOOL_NAMES } from "./tools-catalog";

const PLAN_SYSTEM = `You are a browser-automation planning agent.

You will be given a task and a catalog of MCP tools. Output ONLY a JSON object:
{
  "plan": [string, ...]   // ordered list of tool names you would call to do the task
}

Rules:
- Each entry must be the exact tool name from the catalog (e.g. "navigate", "click").
- Order matters: list the calls as you would actually make them.
- Include every tool you would call, including session setup (e.g. "launch_session").
- Do not include arguments or commentary. Only the JSON object.
- Do not invent tool names not in the catalog.`;

export interface PlanProviderOptions {
  provider?: "anthropic" | "openai" | "claude-cli";
  model?: string;
}

export async function planForTask(
  task: BenchTask,
  options: PlanProviderOptions = {},
): Promise<PlanResult> {
  const provider = options.provider ?? pickProvider();
  const userPrompt = buildUserPrompt(task);
  try {
    const raw = await callPlanner(provider, options.model, userPrompt);
    const plan = parsePlan(raw);
    return { plan, raw };
  } catch (error) {
    return {
      plan: [],
      raw: "",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function pickProvider(): "anthropic" | "openai" | "claude-cli" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "claude-cli";
}

function buildUserPrompt(task: BenchTask): string {
  return [
    `TASK: ${task.confirmed_task}`,
    "",
    "TOOL_CATALOG:",
    formatCatalog(),
    "",
    "Return JSON only.",
  ].join("\n");
}

async function callPlanner(
  provider: "anthropic" | "openai" | "claude-cli",
  model: string | undefined,
  userPrompt: string,
): Promise<string> {
  if (provider === "claude-cli") {
    return callClaudeCli(model, `${PLAN_SYSTEM}\n\n---\n\n${userPrompt}`);
  }
  if (provider === "openai") {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();
    const resp = await client.chat.completions.create({
      model: model ?? "gpt-4.1-mini",
      messages: [
        { role: "system", content: PLAN_SYSTEM },
        { role: "user", content: userPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
    });
    return resp.choices[0]?.message?.content ?? "";
  }
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const resp = await client.messages.create({
    model: model ?? "claude-sonnet-4-5",
    max_tokens: 1024,
    system: PLAN_SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });
  const block = resp.content.find((b) => b.type === "text");
  return block && "text" in block ? block.text : "";
}

async function callClaudeCli(model: string | undefined, fullPrompt: string): Promise<string> {
  const args = ["-p", "--output-format", "text"];
  if (model) args.push("--model", model);
  return new Promise((resolvePromise, reject) => {
    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(`claude CLI exited ${code}: ${stderr.slice(0, 300)}`));
    });
    child.stdin.write(fullPrompt);
    child.stdin.end();
  });
}

function parsePlan(raw: string): string[] {
  let cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  if (!cleaned.startsWith("{")) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) cleaned = match[0];
  }
  try {
    const parsed = JSON.parse(cleaned) as { plan?: unknown };
    if (!Array.isArray(parsed.plan)) return [];
    return parsed.plan.filter((x): x is string => typeof x === "string");
  } catch {
    return [];
  }
}

export function scorePlan(task: BenchTask, called: string[]): ToolChoiceResult {
  const expected = new Set(task.expected_tools);
  const forbidden = new Set(task.forbidden_tools ?? []);
  const calledSet = new Set(called);

  let truePositives = 0;
  for (const name of calledSet) if (expected.has(name)) truePositives += 1;
  const precision = calledSet.size ? truePositives / calledSet.size : 0;
  const recall = expected.size ? truePositives / expected.size : 0;
  const f1 = precision + recall ? (2 * precision * recall) / (precision + recall) : 0;

  const forbiddenHits = called.filter((name) => forbidden.has(name));
  const dedupForbidden = Array.from(new Set(forbiddenHits));

  const minOk = task.min_calls === undefined || called.length >= task.min_calls;
  const maxOk = task.max_calls === undefined || called.length <= task.max_calls;
  const recallOk = recall >= 1;
  const noUnknown = called.every((n) => TOOL_NAMES.includes(n));
  const verdict = recallOk && dedupForbidden.length === 0 && minOk && maxOk && noUnknown;

  const reasons: string[] = [];
  reasons.push(`precision=${precision.toFixed(2)} recall=${recall.toFixed(2)} f1=${f1.toFixed(2)}`);
  if (!recallOk) {
    const missing = task.expected_tools.filter((n) => !calledSet.has(n));
    reasons.push(`missing=${missing.join(",")}`);
  }
  if (dedupForbidden.length) reasons.push(`forbidden_hits=${dedupForbidden.join(",")}`);
  if (!minOk) reasons.push(`min_calls=${task.min_calls} got=${called.length}`);
  if (!maxOk) reasons.push(`max_calls=${task.max_calls} got=${called.length}`);
  if (!noUnknown) {
    const unknown = called.filter((n) => !TOOL_NAMES.includes(n));
    reasons.push(`unknown_tools=${unknown.join(",")}`);
  }

  return {
    called,
    precision,
    recall,
    f1,
    forbidden_hits: dedupForbidden,
    verdict,
    reasoning: reasons.join("; "),
  };
}
