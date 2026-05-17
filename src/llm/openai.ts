import OpenAI from "openai";

import { buildDecisionUserPrompt } from "../agent/loop";
import { SYSTEM_PROMPT } from "../agent/prompts";
import type { AgentInput, AgentOutput } from "../agent/contracts";
import type { LLMAdapterOptions } from "./types";
import { buildTelemetry } from "./telemetry";
import { decisionJsonSchema, validateDecision } from "./decisionSchema";

function buildUserContent(input: AgentInput): Array<
  | {
      type: "input_text";
      text: string;
    }
  | {
      type: "input_image";
      image_url: string;
      detail: string;
    }
> {
  const screenshot = input.browserState?.screenshot;
  return [
    { type: "input_text" as const, text: buildDecisionUserPrompt(input) },
    ...(screenshot
      ? [
          {
            type: "input_image" as const,
            image_url: `data:${screenshot.mediaType};base64,${screenshot.base64}`,
            detail: screenshot.detail,
          },
        ]
      : []),
  ];
}

/**
 * Create a decide adapter backed by the OpenAI Chat Completions API.
 *
 * Targets OpenAI proper. Other providers (OpenRouter, Groq, Together, Ollama)
 * may work via `baseURL` if they support `response_format: json_schema` and
 * `max_completion_tokens`, but compatibility is not guaranteed and varies by
 * model.
 *
 * Uses `response_format: { type: "json_schema" }` for reliable structured
 * output. The model receives the system prompt plus the per-step observation
 * and must return a valid AgentOutput object.
 */
export function createOpenAIDecide(
  options: LLMAdapterOptions,
): (input: AgentInput, signal?: AbortSignal) => Promise<AgentOutput> {
  const client = new OpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    maxRetries: 2,
  });

  const model = options.model;
  const temperature = options.temperature ?? 0.2;
  const maxTokens = options.maxTokens ?? 4096;

  return async (input: AgentInput, signal?: AbortSignal): Promise<AgentOutput> => {
    const startedAt = Date.now();

    const response = await client.responses.parse(
      {
        model,
        temperature,
        max_output_tokens: maxTokens,
        input: [
          { role: "developer", content: [{ type: "input_text", text: SYSTEM_PROMPT }] },
          { role: "user", content: buildUserContent(input) },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "decision",
            description: "Browser agent decision for the current step",
            schema: decisionJsonSchema as unknown as Record<string, unknown>,
          },
        },
      } as Parameters<typeof client.responses.parse>[0],
      { signal },
    );

    const parsed = response.output_parsed;
    if (!parsed) {
      throw new Error("OpenAI response missing parsed structured output");
    }

    const decision = validateDecision(parsed);
    decision.telemetry = buildTelemetry(
      startedAt,
      model,
      response.usage
        ? {
            inputTokens: response.usage.input_tokens,
            outputTokens: response.usage.output_tokens,
            cachedInputTokens: response.usage.input_tokens_details?.cached_tokens,
          }
        : undefined,
    );
    return decision;
  };
}
