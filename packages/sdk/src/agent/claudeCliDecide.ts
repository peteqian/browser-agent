import type { AgentInput, AgentOutput } from "./decide/contracts";
import { SYSTEM_PROMPT } from "./decide/prompts";
import { buildFreeformDecisionPrompt, parseDecision } from "./decide/parseDecision";
import { spawnChildWithSignal } from "./features/spawnChild";

export interface ClaudeCliOptions {
  binaryPath?: string;
  model: string;
  cwd?: string;
  onRaw?: (raw: string, step: number) => void;
}

/**
 * Claude CLI adapter. Spawns the `claude` binary in headless single-turn
 * mode (`-p ... --output-format json --max-turns 1`) and parses the result
 * field from its JSON envelope.
 *
 * Used as the fallback when `@anthropic-ai/claude-agent-sdk` is unavailable
 * but the Claude CLI is installed locally.
 */
export function createClaudeCliDecide(
  options: ClaudeCliOptions,
): (input: AgentInput, signal?: AbortSignal) => Promise<AgentOutput> {
  return async (input, signal) => {
    const startedAt = Date.now();
    const prompt = `${SYSTEM_PROMPT}\n\n${buildFreeformDecisionPrompt(input)}`;
    const raw = await callClaude({
      binaryPath: options.binaryPath,
      model: options.model,
      prompt,
      cwd: options.cwd,
      signal,
    });
    options.onRaw?.(raw, input.step);

    const decision = parseDecision(raw);
    decision.telemetry = {
      latencyMs: Date.now() - startedAt,
      model: options.model,
    };
    return decision;
  };
}

async function callClaude(request: {
  binaryPath?: string;
  model: string;
  prompt: string;
  cwd?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const bin = request.binaryPath?.trim() || process.env.CLAUDE_BIN || "claude";
  const args = [
    "-p",
    request.prompt,
    "--model",
    request.model,
    "--output-format",
    "json",
    "--max-turns",
    "1",
  ];

  const { stdout, stderr, exitCode } = await spawnChildWithSignal({
    bin,
    args,
    cwd: request.cwd,
    signal: request.signal,
    label: "Claude CLI",
  });

  if (exitCode !== 0) {
    throw new Error(`Claude CLI exited with code ${exitCode}: ${stderr}`);
  }

  // CLI output is a JSON envelope: { type: "result", result: "<assistant text>", ... }
  const envelope = JSON.parse(stdout) as { result?: unknown; subtype?: unknown };
  if (typeof envelope.result !== "string") {
    throw new Error("Claude CLI envelope missing result string");
  }
  return envelope.result;
}
