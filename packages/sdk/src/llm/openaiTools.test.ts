import { afterEach, describe, expect, test, mock } from "bun:test";

import type { AgentInput, ToolDef } from "../agent/contracts";

interface CapturedCall {
  calls: Array<Record<string, unknown>>;
}

const captured: CapturedCall = { calls: [] };
// Queue of responses the fake client returns, in order.
let responseQueue: Array<Record<string, unknown>> = [];

mock.module("openai", () => {
  class FakeOpenAI {
    public chat = {
      completions: {
        create: async (args: Record<string, unknown>) => {
          captured.calls.push(args);
          return (
            responseQueue.shift() ?? {
              choices: [{ message: { role: "assistant", content: "", tool_calls: [] } }],
              usage: { prompt_tokens: 1, completion_tokens: 1 },
            }
          );
        },
      },
    };
    constructor(_opts: unknown) {
      void _opts;
    }
  }
  return { default: FakeOpenAI };
});

afterEach(() => {
  captured.calls = [];
  responseQueue = [];
});

const TOOLS: ToolDef[] = [
  {
    name: "navigate",
    description: "Load a URL",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
  },
  {
    name: "done",
    description: "Finish",
    parameters: { type: "object", properties: { success: { type: "boolean" } } },
  },
];

function makeInput(over: Partial<AgentInput> = {}): AgentInput {
  return {
    task: "go to example.com",
    step: 1,
    observation: "URL: about:blank",
    tabs: ["t1"],
    activeTab: "t1",
    history: [],
    tools: TOOLS,
    ...over,
  };
}

function toolCallResponse(id: string, name: string, args: Record<string, unknown>) {
  return {
    choices: [
      {
        message: {
          role: "assistant",
          content: null,
          tool_calls: [
            { id, type: "function", function: { name, arguments: JSON.stringify(args) } },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 3, prompt_tokens_details: { cached_tokens: 0 } },
  };
}

describe("createOpenAIToolDecide", () => {
  test("first turn sends system + user, passes tools, disables parallel calls", async () => {
    const { createOpenAIToolDecide } = await import("./openaiTools");
    const decide = createOpenAIToolDecide({ model: "gpt-4.1-mini", apiKey: "k" });
    responseQueue = [toolCallResponse("call_1", "navigate", { url: "https://example.com" })];

    const out = await decide(makeInput());

    expect(out.actions).toEqual([{ name: "navigate", params: { url: "https://example.com" } }]);
    expect(out.done).toBe(false);

    const req = captured.calls[0]!;
    expect(req.parallel_tool_calls).toBe(false);
    expect(req.tool_choice).toBe("auto");
    const messages = req.messages as Array<{ role: string; content?: string }>;
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.content).toContain("go to example.com");
    const tools = req.tools as Array<{ type: string; function: { name: string } }>;
    expect(tools.map((t) => t.function.name)).toEqual(["navigate", "done"]);
  });

  test("continuation turn appends the prior tool result by id and only the new observation", async () => {
    const { createOpenAIToolDecide } = await import("./openaiTools");
    const decide = createOpenAIToolDecide({ model: "gpt-4.1-mini", apiKey: "k" });
    responseQueue = [
      toolCallResponse("call_1", "navigate", { url: "https://example.com" }),
      toolCallResponse("call_2", "done", { success: true, summary: "H1 is Example Domain" }),
    ];

    await decide(makeInput());
    const out2 = await decide(
      makeInput({ step: 2, observation: "URL: https://example.com\nH1: Example Domain" }),
    );

    expect(out2.done).toBe(true);
    expect(out2.success).toBe(true);
    expect(out2.summary).toBe("H1 is Example Domain");

    const req2 = captured.calls[1]!;
    const messages = req2.messages as Array<{
      role: string;
      tool_call_id?: string;
      content?: string;
    }>;
    const toolMsg = messages.find((m) => m.role === "tool");
    expect(toolMsg?.tool_call_id).toBe("call_1");
    expect(toolMsg?.content).toContain("Example Domain");
    // The first turn's user message should NOT be repeated; only system+user
    // from turn 1, the assistant tool call, then the tool result.
    expect(messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  test("honors only the first tool call when the model emits several", async () => {
    const { createOpenAIToolDecide } = await import("./openaiTools");
    const decide = createOpenAIToolDecide({ model: "gpt-4.1-mini", apiKey: "k" });
    responseQueue = [
      {
        choices: [
          {
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "a",
                  type: "function",
                  function: { name: "navigate", arguments: '{"url":"https://a.com"}' },
                },
                {
                  id: "b",
                  type: "function",
                  function: { name: "navigate", arguments: '{"url":"https://b.com"}' },
                },
              ],
            },
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2 },
      },
    ];

    const out = await decide(makeInput());
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0]).toEqual({ name: "navigate", params: { url: "https://a.com" } });
  });

  test("text-only reply yields no action (loop handles the stall)", async () => {
    const { createOpenAIToolDecide } = await import("./openaiTools");
    const decide = createOpenAIToolDecide({ model: "gpt-4.1-mini", apiKey: "k" });
    responseQueue = [
      {
        choices: [{ message: { role: "assistant", content: "thinking..." } }],
        usage: { prompt_tokens: 3, completion_tokens: 1 },
      },
    ];

    const out = await decide(makeInput());
    expect(out.actions).toEqual([]);
    expect(out.done).toBe(false);
  });

  test("surfaces token usage as telemetry", async () => {
    const { createOpenAIToolDecide } = await import("./openaiTools");
    const decide = createOpenAIToolDecide({ model: "gpt-4.1-mini", apiKey: "k" });
    responseQueue = [
      {
        choices: [
          {
            message: {
              role: "assistant",
              tool_calls: [
                { id: "x", type: "function", function: { name: "done", arguments: "{}" } },
              ],
            },
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 20,
          prompt_tokens_details: { cached_tokens: 80 },
        },
      },
    ];

    const out = await decide(makeInput());
    expect(out.telemetry?.usage?.inputTokens).toBe(100);
    expect(out.telemetry?.usage?.outputTokens).toBe(20);
    expect(out.telemetry?.usage?.cachedInputTokens).toBe(80);
  });
});
