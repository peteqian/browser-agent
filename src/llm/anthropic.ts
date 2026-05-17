import Anthropic from "@anthropic-ai/sdk";
import { jsonSchemaOutputFormat } from "@anthropic-ai/sdk/helpers/json-schema";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";

import { buildDecisionUserPrompt } from "../agent/loop";
import { SYSTEM_PROMPT } from "../agent/prompts";
import type { AgentInput, AgentOutput } from "../agent/contracts";
import type { LLMAdapterOptions } from "./types";
import { buildTelemetry } from "./telemetry";
import { decisionJsonSchema, validateDecision } from "./decisionSchema";

function buildUserContent(input: AgentInput): ContentBlockParam[] {
  const screenshot = input.browserState?.screenshot;
  const blocks: ContentBlockParam[] = [{ type: "text", text: buildDecisionUserPrompt(input) }];
  if (screenshot) {
    blocks.unshift({
      type: "image",
      source: {
        type: "base64",
        media_type: screenshot.mediaType,
        data: screenshot.base64,
      },
    });
  }
  return blocks;
}

/**
 * Create a decide adapter backed by the Anthropic Messages API.
 *
 * Uses the official `@anthropic-ai/sdk` with native structured output
 * (`jsonSchemaOutputFormat`) for reliable AgentOutput parsing.
 */
export function createAnthropicDecide(
  options: LLMAdapterOptions,
): (input: AgentInput, signal?: AbortSignal) => Promise<AgentOutput> {
  const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("Anthropic adapter requires apiKey or ANTHROPIC_API_KEY env var");
  }

  const client = new Anthropic({
    apiKey,
    baseURL: options.baseURL,
    maxRetries: 2,
  });

  const model = options.model;
  const maxTokens = options.maxTokens ?? 4096;

  return async (input: AgentInput, signal?: AbortSignal): Promise<AgentOutput> => {
    const startedAt = Date.now();

    const message = await client.messages.parse(
      {
        model,
        max_tokens: maxTokens,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserContent(input) }],
        output_config: {
          format: jsonSchemaOutputFormat(
            decisionJsonSchema as unknown as Parameters<typeof jsonSchemaOutputFormat>[0],
          ),
        },
      },
      { signal },
    );

    const raw = message.parsed_output;
    if (!raw) {
      throw new Error("Anthropic response missing parsed_output");
    }

    const decision = validateDecision(raw);
    decision.telemetry = buildTelemetry(
      startedAt,
      model,
      message.usage
        ? {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            cachedInputTokens: message.usage.cache_read_input_tokens ?? undefined,
          }
        : undefined,
    );
    return decision;
  };
}
