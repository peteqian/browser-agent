import { spawn } from "node:child_process";

import type { BenchTask, JudgementResult } from "./types";

const SYSTEM = `You are a strict evaluator scoring whether a browser-automation agent completed a web task.

Given:
- The task instruction.
- (Optional) the ground-truth answer.
- The agent's final summary string and termination reason.

Return ONLY a single JSON object with this exact shape:
{
  "reasoning": string,
  "verdict": boolean,
  "failure_reason": string | null,
  "impossible_task": boolean,
  "reached_captcha": boolean
}

Rubric:
- verdict=true only if the agent's summary clearly answers the task and (if a ground-truth answer is given) matches it semantically.
- If the agent hallucinated content not actually visited, verdict=false.
- If the agent hit a captcha / anti-bot wall it could not pass, reached_captcha=true, verdict=false.
- If the task itself is impossible (site offline, content removed), impossible_task=true; verdict=false unless agent correctly reported impossibility.
- Be terse in reasoning. No prose outside the JSON.`;

interface JudgeInput {
  task: BenchTask;
  agentSummary: string;
  agentReason: string;
  trajectory?: string;
}

export interface JudgeOptions {
  provider?: "claude" | "anthropic" | "openai" | "claude-cli";
  model?: string;
}

export async function judge(
  input: JudgeInput,
  options: JudgeOptions = {},
): Promise<JudgementResult> {
  const provider = options.provider ?? pickJudgeProvider();
  const userPrompt = buildUserPrompt(input);

  const raw = await callJudge(provider, options.model, userPrompt);
  return parseJudgement(raw);
}

function pickJudgeProvider(): "anthropic" | "openai" | "claude-cli" {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "claude-cli";
}

function buildUserPrompt(input: JudgeInput): string {
  return [
    `TASK: ${input.task.confirmed_task}`,
    input.task.answer
      ? `GROUND_TRUTH_ANSWER: ${input.task.answer}`
      : "GROUND_TRUTH_ANSWER: (none — judge on plausibility)",
    `AGENT_TERMINATION_REASON: ${input.agentReason}`,
    `AGENT_FINAL_SUMMARY:\n${input.agentSummary || "(empty)"}`,
    `AGENT_TRAJECTORY (last ~30 lines):\n${(input.trajectory ?? "").split("\n").slice(-30).join("\n") || "(empty)"}`,
    "",
    "Return JSON only.",
  ].join("\n");
}

async function callJudge(
  provider: "claude" | "anthropic" | "openai" | "claude-cli",
  model: string | undefined,
  userPrompt: string,
): Promise<string> {
  if (provider === "claude-cli" || provider === "claude") {
    return callClaudeCli(model, userPrompt);
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
    max_tokens: 1024,
    system: SYSTEM,
    messages: [{ role: "user", content: userPrompt }],
  });
  const block = resp.content.find((b) => b.type === "text");
  return block && "text" in block ? block.text : "";
}

async function callClaudeCli(model: string | undefined, userPrompt: string): Promise<string> {
  const fullPrompt = `${SYSTEM}\n\n---\n\n${userPrompt}`;
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

function parseJudgement(raw: string): JudgementResult {
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
    const parsed = JSON.parse(cleaned) as Partial<JudgementResult>;
    return {
      reasoning: String(parsed.reasoning ?? ""),
      verdict: Boolean(parsed.verdict),
      failure_reason: parsed.failure_reason ?? null,
      impossible_task: Boolean(parsed.impossible_task),
      reached_captcha: Boolean(parsed.reached_captcha),
    };
  } catch {
    return {
      reasoning: `Judge returned non-JSON output: ${raw.slice(0, 200)}`,
      verdict: false,
      failure_reason: "judge_parse_error",
      impossible_task: false,
      reached_captcha: false,
    };
  }
}
