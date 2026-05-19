import { query } from "@anthropic-ai/claude-agent-sdk";

import type { AgentInput, AgentOutput } from "./contracts";
import { buildDecisionPromptParts } from "./decision-prompt";
import { buildFreeformDecisionPrompt, parseDecision } from "./parseDecision";
import { buildTelemetry } from "../llm/telemetry";

export interface ClaudeSdkOptions {
  model: string;
  apiKey?: string;
  cwd?: string;
  onRaw?: (raw: string, step: number) => void;
}

/**
 * Claude Agent SDK adapter. Disables all built-in tools so the model returns
 * a single JSON action per call, matching the existing CLI/Codex adapters.
 *
 * Aborts via the SDK's `abortController` option. The signal forwarded by the
 * loop is bridged to a per-call AbortController.
 */
export function createClaudeSdkDecide(
  options: ClaudeSdkOptions,
): (input: AgentInput, signal?: AbortSignal) => Promise<AgentOutput> {
  // Pass apiKey through the SDK's per-call `env` option instead of mutating
  // global process.env so multiple instances with different keys can coexist.
  const queryEnv = options.apiKey
    ? { ...filterStringEnv(process.env), ANTHROPIC_API_KEY: options.apiKey }
    : undefined;

  return async (input, signal) => {
    const startedAt = Date.now();
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    if (signal) {
      if (signal.aborted) abortController.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      // The freeform user prompt carries the per-step suffix (observation,
      // history, task). The system prompt carries the cacheable prefix
      // (system instructions + action catalog). The Agent SDK handles
      // prompt-cache markers internally; passing the prefix as the system
      // string keeps it stable across steps so the SDK's transport pins it.
      const { prefix } = buildDecisionPromptParts(input);
      const prompt = buildFreeformDecisionPrompt(input);
      const iter = query({
        prompt,
        options: {
          model: options.model,
          systemPrompt: prefix,
          maxTurns: 1,
          tools: [],
          abortController,
          ...(options.cwd ? { cwd: options.cwd } : {}),
          ...(queryEnv ? { env: queryEnv } : {}),
        },
      });

      let raw = "";
      let usage:
        | {
            input_tokens?: number;
            output_tokens?: number;
            cache_read_input_tokens?: number;
            cache_creation_input_tokens?: number;
          }
        | undefined;
      for await (const message of iter) {
        if (message.type === "result") {
          if (message.subtype !== "success") {
            throw new Error(`Claude SDK turn failed: ${message.subtype}`);
          }
          raw = message.result;
          const u = message.usage as Record<string, unknown> | undefined;
          if (u) {
            usage = {
              input_tokens: typeof u.input_tokens === "number" ? u.input_tokens : undefined,
              output_tokens: typeof u.output_tokens === "number" ? u.output_tokens : undefined,
              cache_read_input_tokens:
                typeof u.cache_read_input_tokens === "number"
                  ? u.cache_read_input_tokens
                  : undefined,
              cache_creation_input_tokens:
                typeof u.cache_creation_input_tokens === "number"
                  ? u.cache_creation_input_tokens
                  : undefined,
            };
          }
        }
      }

      if (!raw) {
        throw new Error("Claude SDK returned no result message");
      }

      options.onRaw?.(raw, input.step);
      const decision = parseDecision(raw);
      decision.telemetry = buildTelemetry(
        startedAt,
        options.model,
        usage
          ? {
              inputTokens: usage.input_tokens ?? 0,
              outputTokens: usage.output_tokens ?? 0,
              cachedInputTokens: usage.cache_read_input_tokens,
              cacheCreationTokens: usage.cache_creation_input_tokens,
            }
          : undefined,
      );
      return decision;
    } finally {
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  };
}

function filterStringEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}
