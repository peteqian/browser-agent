import { query } from "@anthropic-ai/claude-agent-sdk";

import type { AgentInput, AgentOutput } from "../../agent/decide/contracts";
import { buildDecisionPromptParts } from "../../agent/decide/decision-prompt";
import {
  buildContinuationPrompt,
  buildFreeformDecisionPrompt,
  parseDecision,
} from "../../agent/decide/parseDecision";
import { buildTelemetry } from "../telemetry";

export interface ClaudeSdkOptions {
  model: string;
  apiKey?: string;
  cwd?: string;
  onRaw?: (raw: string, step: number) => void;
}

/**
 * Claude Agent SDK adapter. Disables all built-in tools so the model returns
 * browser-agent JSON decisions instead of calling provider-native tools.
 *
 * Keeps ONE session for the whole run (like the codex SDK adapter): turn 1
 * sends the system prompt + full prompt and captures the session id; later
 * turns `resume` that session and send only the new observation, so the SDK
 * carries the conversation instead of us replaying history every step.
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

  let sessionId: string | null = null;
  let lastCatalog: string | undefined;

  return async (input, signal) => {
    const startedAt = Date.now();
    const abortController = new AbortController();
    const onAbort = () => abortController.abort();
    if (signal) {
      if (signal.aborted) abortController.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }

    try {
      // Turn 1: full prompt + system prefix. Later turns: resume the session
      // and send only the continuation (new observation), re-sending the
      // catalog only when state-scoped actions change.
      const isFirst = sessionId === null;
      const { prefix } = buildDecisionPromptParts(input);
      const prompt = isFirst
        ? buildFreeformDecisionPrompt(input)
        : buildContinuationPrompt(input, { includeCatalog: input.actionCatalog !== lastCatalog });
      lastCatalog = input.actionCatalog;
      const iter = query({
        prompt,
        options: {
          model: options.model,
          maxTurns: 1,
          tools: [],
          abortController,
          ...(isFirst ? { systemPrompt: prefix } : { resume: sessionId ?? undefined }),
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
        // Capture/refresh the session id from any message that carries it so
        // the next step can resume this conversation.
        const sid = (message as { session_id?: unknown }).session_id;
        if (typeof sid === "string" && sid.length > 0) sessionId = sid;
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
