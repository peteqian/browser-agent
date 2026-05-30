import { afterEach, describe, expect, test, mock } from "bun:test";

import type { AgentInput } from "../agent/contracts";

interface CapturedCall {
  args?: Parameters<typeof JSON.stringify>[0];
}

const captured: CapturedCall = {};

// Stub the Anthropic SDK so the adapter calls the mocked client instead of
// hitting the network. mock.module must run before the dynamic import.
mock.module("@anthropic-ai/sdk", () => {
  class FakeAnthropic {
    public messages = {
      parse: async (args: unknown) => {
        captured.args = args as never;
        return {
          parsed_output: {
            actions: [{ name: "done", params: { success: true, summary: "ok" } }],
            done: true,
          },
          usage: {
            input_tokens: 12,
            output_tokens: 4,
            cache_read_input_tokens: 4123,
            cache_creation_input_tokens: 0,
          },
        };
      },
    };
    constructor(_opts: unknown) {
      void _opts;
    }
  }
  return { default: FakeAnthropic };
});

mock.module("@anthropic-ai/sdk/helpers/json-schema", () => ({
  jsonSchemaOutputFormat: (schema: unknown) => ({ schema }),
}));

afterEach(() => {
  captured.args = undefined;
});

function makeInput(): AgentInput {
  return {
    task: "Test cache pinning",
    step: 1,
    observation: "obs",
    tabs: ["t1"],
    activeTab: "t1",
    history: [],
    actionCatalog: "- done: finish",
  };
}

describe("createAnthropicDecide", () => {
  test("pins the system prompt + action catalog as an ephemeral cache block", async () => {
    const { createAnthropicDecide } = await import("./anthropic");
    const decide = createAnthropicDecide({ apiKey: "test", model: "claude-sonnet-4-5" });
    const out = await decide(makeInput());
    expect(out.done).toBe(true);

    const args = captured.args as
      | {
          system: Array<{ type: string; text: string; cache_control?: { type: string } }>;
        }
      | undefined;
    expect(args).toBeDefined();
    expect(Array.isArray(args!.system)).toBe(true);
    expect(args!.system.length).toBeGreaterThan(0);
    const first = args!.system[0]!;
    expect(first.type).toBe("text");
    expect(first.cache_control).toEqual({ type: "ephemeral" });
    expect(first.text).toContain("browser automation agent");
    // Action catalog is part of the cacheable prefix.
    expect(first.text).toContain("- done: finish");
  });

  test("surfaces cache_read_input_tokens / cache_creation_input_tokens in telemetry", async () => {
    const { createAnthropicDecide } = await import("./anthropic");
    const decide = createAnthropicDecide({ apiKey: "test", model: "claude-sonnet-4-5" });
    const out = await decide(makeInput());
    expect(out.telemetry?.usage?.cachedInputTokens).toBe(4123);
    expect(out.telemetry?.usage?.cacheCreationTokens).toBe(0);
    expect(out.telemetry?.usage?.inputTokens).toBe(12);
    expect(out.telemetry?.usage?.outputTokens).toBe(4);
  });
});
