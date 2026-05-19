import { spawn } from "node:child_process";

import type { BenchTask } from "./types";

const SYSTEM = `You are a strict evaluator scoring whether a browser-automation agent picked the right MCP tools for a task.

Given:
- The task instruction.
- The list of expected tools (ground truth) and any forbidden tools.
- The actual ordered plan of tool names the agent produced.

Return ONLY a single JSON object:
{
  "reasoning": string,
  "verdict": boolean
}

Rubric:
- verdict=true only if the plan covers all expected tools in a sensible order AND does NOT include any forbidden tools.
- Extra reasonable tools (e.g. wait, get_snapshot) are OK if they don't conflict.
- If a forbidden tool is present, verdict=false.
- Be terse. No prose outside the JSON.`;

export interface JudgeInput {
  task: BenchTask;
  plan: string[];
}

export interface JudgeOptions {
  provider?: "anthropic" | "openai" | "claude-cli";
  model?: string;
}

export interface JudgeOutput {
  reasoning: string;
  verdict: boolean;
}

export async function judge(input: JudgeInput, options: JudgeOptions = {}): Promise<JudgeOutput> {
  const provider = options.provider ?? pickJudgeProvider();
  const userPrompt = buildUserPrompt(input);
  try {
    const raw = await callJudge(provider, options.model, userPrompt);
    return parseJudgement(raw);
  } catch (error) {
    return {
      reasoning: `Judge call failed: ${error instanceof Error ? error.message : String(error)}`,
      verdict: false,
    };
  }
}

function pickJudgeProvider(): "anthropic" | "openai" | "claude-cli" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "claude-cli";
}

function buildUserPrompt(input: JudgeInput): string {
  return [
    `TASK: ${input.task.confirmed_task}`,
    `EXPECTED_TOOLS: ${input.task.expected_tools.join(", ")}`,
    `FORBIDDEN_TOOLS: ${(input.task.forbidden_tools ?? []).join(", ") || "(none)"}`,
    `AGENT_PLAN: ${input.plan.join(", ") || "(empty)"}`,
    "",
    "Return JSON only.",
  ].join("\n");
}

async function callJudge(
  provider: "anthropic" | "openai" | "claude-cli",
  model: string | undefined,
  userPrompt: string,
): Promise<string> {
  if (provider === "claude-cli") {
    return callClaudeCli(model, `${SYSTEM}\n\n---\n\n${userPrompt}`);
  }
  if (provider === "openai") {
    const { default: OpenAI } = await import("openai");
    const client = new OpenAI();
    const resp = await client.chat.completions.create({
      model: model ?? "gpt-4.1-mini",
      messages: [
        { role: "system", content: SYSTEM },
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
    max_tokens: 512,
    system: SYSTEM,
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

function parseJudgement(raw: string): JudgeOutput {
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
    const parsed = JSON.parse(cleaned) as Partial<JudgeOutput>;
    return {
      reasoning: String(parsed.reasoning ?? ""),
      verdict: Boolean(parsed.verdict),
    };
  } catch {
    return {
      reasoning: `Judge returned non-JSON output: ${raw.slice(0, 200)}`,
      verdict: false,
    };
  }
}
