import OpenAI from "openai";
import type {
  ChatCompletionMessageParam,
  ChatCompletionTool,
} from "openai/resources/chat/completions";

import type { AgentInput, AgentOutput, ToolDef } from "../agent/contracts";
import { TOOL_SYSTEM_PROMPT } from "../agent/prompts";
import type { LLMAdapterOptions } from "./types";
import { buildTelemetry } from "./telemetry";

/**
 * Native tool-calling adapter for the OpenAI Chat Completions API (and
 * OpenAI-compatible endpoints via `baseURL`, including codex models served
 * over the same protocol).
 *
 * Unlike the structured-output adapter, this keeps ONE conversation for the
 * whole run: the system prompt and task go out once, each browser action is a
 * real tool the model calls, and each tool result is the next page
 * observation. `parallel_tool_calls: false` enforces exactly one action per
 * turn — there is no batching. This is the lean, low-latency path: only the
 * new observation is sent each turn, and the provider caches the stable
 * conversation prefix.
 */
export function createOpenAIToolDecide(
  options: LLMAdapterOptions,
): (input: AgentInput, signal?: AbortSignal) => Promise<AgentOutput> {
  const client = new OpenAI({ apiKey: options.apiKey, baseURL: options.baseURL, maxRetries: 2 });
  const model = options.model;
  const temperature = options.temperature ?? 0.2;
  const maxTokens = options.maxTokens ?? 4096;

  const messages: ChatCompletionMessageParam[] = [];
  // The tool_call id we returned last turn and still owe a tool result for.
  let pendingToolCallId: string | null = null;

  return async (input: AgentInput, signal?: AbortSignal): Promise<AgentOutput> => {
    const startedAt = Date.now();

    if (messages.length === 0) {
      messages.push({ role: "system", content: TOOL_SYSTEM_PROMPT });
      messages.push({ role: "user", content: firstTurnText(input) });
    } else if (pendingToolCallId) {
      // The model's last turn called a tool; the protocol requires its result
      // before the next turn. The result IS the new page observation.
      messages.push({
        role: "tool",
        tool_call_id: pendingToolCallId,
        content: continuationText(input),
      });
      pendingToolCallId = null;
    } else {
      // Last turn produced no tool call (text only) — continue as a user turn.
      messages.push({ role: "user", content: continuationText(input) });
    }

    const tools = toOpenAITools(input.tools ?? []);

    const response = await client.chat.completions.create(
      {
        model,
        temperature,
        max_completion_tokens: maxTokens,
        messages,
        tools,
        tool_choice: "auto",
        parallel_tool_calls: false,
      },
      { signal },
    );

    const choice = response.choices[0];
    const message = choice?.message;
    // Preserve the assistant turn verbatim so the next tool result links to it.
    if (message) messages.push(message);

    const decision = buildDecision(message);
    if (decision.pendingToolCallId) pendingToolCallId = decision.pendingToolCallId;

    decision.output.telemetry = buildTelemetry(
      startedAt,
      model,
      response.usage
        ? {
            inputTokens: response.usage.prompt_tokens,
            outputTokens: response.usage.completion_tokens,
            cachedInputTokens: response.usage.prompt_tokens_details?.cached_tokens,
          }
        : undefined,
    );
    return decision.output;
  };
}

function buildDecision(message: { tool_calls?: unknown; content?: string | null } | undefined): {
  output: AgentOutput;
  pendingToolCallId: string | null;
} {
  const toolCalls = (message?.tool_calls ?? []) as Array<{
    id: string;
    type: string;
    function?: { name: string; arguments: string };
  }>;
  // One action per turn: honor only the first tool call.
  const first = toolCalls.find((c) => c.type === "function" && c.function);
  if (!first?.function) {
    // Text-only reply: no action this turn. The loop's empty-decision guard
    // handles a model that stalls without calling a tool.
    return { output: { actions: [], done: false }, pendingToolCallId: null };
  }

  let params: Record<string, unknown> = {};
  try {
    params = first.function.arguments ? JSON.parse(first.function.arguments) : {};
  } catch {
    // Malformed arguments — surface as an empty-param action so the registry
    // rejects it with a schema message the model sees next turn.
    params = {};
  }

  const name = first.function.name;
  const done = name === "done";
  return {
    output: {
      actions: [{ name, params }],
      done,
      summary: done && typeof params.summary === "string" ? params.summary : undefined,
      success: done && typeof params.success === "boolean" ? params.success : undefined,
    },
    pendingToolCallId: first.id,
  };
}

function toOpenAITools(tools: ToolDef[]): ChatCompletionTool[] {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }));
}

function firstTurnText(input: AgentInput): string {
  return `Task: ${input.task}

${continuationText(input)}`;
}

function continuationText(input: AgentInput): string {
  const tabs = input.tabs.length > 0 ? input.tabs.join(", ") : "(none)";
  return `Step ${input.step}
Active tab: ${input.activeTab}
Open tabs: ${tabs}

Observation:
${input.observation}`;
}
