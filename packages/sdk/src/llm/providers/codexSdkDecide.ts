import { Codex, type ModelReasoningEffort, type Thread } from "@openai/codex-sdk";

import type { AgentInput, AgentOutput } from "../../agent/decide/contracts";
import { SYSTEM_PROMPT } from "../../agent/decide/prompts";
import {
  buildContinuationPrompt,
  buildFreeformDecisionPrompt,
  parseDecision,
} from "../../agent/decide/parseDecision";
import { buildTelemetry } from "../telemetry";

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
 * Codex SDK adapter. Keeps ONE thread for the whole run: the system prompt,
 * task, and action catalog go out on the first turn; subsequent turns send
 * only the new observation (the thread carries the conversation). This avoids
 * re-ingesting the full prompt every step — the dominant per-step latency
 * source when a fresh thread was created each time.
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
  let thread: Thread | null = null;
  let lastCatalog: string | undefined;

  return async (input, signal) => {
    const startedAt = Date.now();

    let prompt: string;
    if (!thread) {
      thread = codex.startThread({
        model: options.model,
        ...(reasoningEffort ? { modelReasoningEffort: reasoningEffort } : {}),
        ...(options.cwd ? { workingDirectory: options.cwd } : {}),
        skipGitRepoCheck: true,
        sandboxMode: "read-only",
      });
      prompt = `${SYSTEM_PROMPT}\n\n${buildFreeformDecisionPrompt(input)}`;
    } else {
      // Re-send the catalog only when state-scoped actions changed.
      const includeCatalog = input.actionCatalog !== lastCatalog;
      prompt = buildContinuationPrompt(input, { includeCatalog });
    }
    lastCatalog = input.actionCatalog;

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
