import { describe, expect, it } from "bun:test";

import { Browser } from "../browser/browser";
import { Agent, runTask } from "./agent";

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

  it("runs a one-shot task", async () => {
    const result = await runTask({
      task: "Report done.",
      fullSnapshots: true,
      getNextAction: async () => ({
        done: true,
        success: true,
        summary: "ok",
        actions: [{ name: "done", params: { success: true, summary: "ok" } }],
      }),
    });

    expect(result).toMatchObject({
      success: true,
      reason: "completed",
      summary: "ok",
      steps: 1,
    });
    // Launches a real browser; a cold CI runner may download Chrome-for-Testing
    // first, which blows past the 5s default per-test timeout.
  }, 120_000);
});
