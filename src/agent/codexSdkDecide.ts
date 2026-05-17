import { Codex, type ModelReasoningEffort } from "@openai/codex-sdk";

import type { AgentInput, AgentOutput } from "./contracts";
import { SYSTEM_PROMPT } from "./prompts";
import { buildFreeformDecisionPrompt, parseDecision } from "./parseDecision";
import { buildTelemetry } from "../llm/telemetry";

export interface CodexSdkOptions {
  model: string;
  effort?: string;
  cwd?: string;
  codexHome?: string;
  apiKey?: string;
  baseUrl?: string;
  onRaw?: (raw: string, step: number) => void;
}

const VALID_EFFORTS: readonly ModelReasoningEffort[] = [
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
];

/**
 * Codex SDK adapter. Each decision creates a fresh thread and runs a single
 * turn. Stateless across steps so it matches the existing CLI adapter; the
 * loop carries history through the prompt itself.
 */
export function createCodexSdkDecide(
  options: CodexSdkOptions,
): (input: AgentInput, signal?: AbortSignal) => Promise<AgentOutput> {
  const codex = new Codex({
    ...(options.apiKey ? { apiKey: options.apiKey } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
    ...(options.codexHome ? { codexPathOverride: options.codexHome } : {}),
  });

  const reasoningEffort = normalizeEffort(options.effort);

  return async (input, signal) => {
    const startedAt = Date.now();
    const thread = codex.startThread({
      model: options.model,
      ...(reasoningEffort ? { modelReasoningEffort: reasoningEffort } : {}),
      ...(options.cwd ? { workingDirectory: options.cwd } : {}),
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
    });

    const prompt = `${SYSTEM_PROMPT}\n\n${buildFreeformDecisionPrompt(input)}`;
    const turn = await thread.run(prompt, { signal });
    const raw = turn.finalResponse;
    options.onRaw?.(raw, input.step);

    const decision = parseDecision(raw);
    decision.telemetry = buildTelemetry(
      startedAt,
      options.model,
      turn.usage
        ? {
            inputTokens: turn.usage.input_tokens,
            outputTokens: turn.usage.output_tokens,
            cachedInputTokens: turn.usage.cached_input_tokens,
          }
        : undefined,
    );
    return decision;
  };
}

function normalizeEffort(raw?: string): ModelReasoningEffort | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase() as ModelReasoningEffort;
  return VALID_EFFORTS.includes(lower) ? lower : undefined;
}
