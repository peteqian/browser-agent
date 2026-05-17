import { describe, expect, it } from "bun:test";

import { Browser } from "../browser/browser";
import { Agent } from "./agent";

describe("Agent", () => {
  it("can be created with the simple options", () => {
    const browser = new Browser();
    const agent = new Agent({
      task: "Go to example.com and report the H1.",
      browser,
      llm: { provider: "openai", model: "gpt-4.1-mini" },
      startUrl: "https://example.com",
      useVision: "auto",
    });

    expect(agent).toBeInstanceOf(Agent);
  });

  it("accepts getNextAction as the custom AI output hook", () => {
    const agent = new Agent({
      task: "Report done.",
      getNextAction: async () => ({
        done: true,
        success: true,
        summary: "ok",
        actions: [{ name: "done", params: { success: true, summary: "ok" } }],
      }),
    });

    expect(agent).toBeInstanceOf(Agent);
  });
});
