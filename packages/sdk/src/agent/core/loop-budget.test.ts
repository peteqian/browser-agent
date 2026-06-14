import { describe, expect, test } from "bun:test";

import type { Page } from "../../browser/session/session";
import { runLoop } from "./loop";

function makeFakeCdpSnapshot() {
  const strings = ["https://example.com/", "Example", "BUTTON", "block", "visible", "1", "First"];
  return {
    documents: [
      {
        documentURL: 0,
        title: 1,
        nodes: { nodeName: [2], backendNodeId: [0], attributes: [[]] },
        layout: {
          nodeIndex: [0],
          bounds: [[0, 0, 10, 10]],
          styles: [[3, 4, 5, -1, -1, -1, -1]],
          text: [6],
          paintOrders: [0],
        },
      },
    ],
    strings,
  };
}

function createFakePage(): Page {
  return {
    targetId: "page-1",
    waitForStablePage: async () => {},
    getPendingNetworkRequests: async () => [],
    evaluate: async () => ({ readyState: "complete", pendingRequestCount: 0 }),
    sendCDP: async (method: string) => {
      if (method === "Accessibility.getFullAXTree") return { nodes: [] };
      if (method === "DOMSnapshot.captureSnapshot") return makeFakeCdpSnapshot();
      return {};
    },
  } as unknown as Page;
}

describe("runLoop budget enforcement", () => {
  test("token budget stops the run with budget_exceeded", async () => {
    let decisions = 0;
    const result = await runLoop({
      task: "spend tokens forever",
      page: createFakePage(),
      challengeWatchdog: false,
      budget: { maxTokens: 1500 },
      decide: async () => {
        decisions += 1;
        return {
          actions: [{ name: "wait", params: { ms: 1 } }],
          done: false,
          telemetry: {
            model: "claude-sonnet-4-6",
            usage: { inputTokens: 900, outputTokens: 100 },
          },
        };
      },
    });

    expect(result.reason).toBe("budget_exceeded");
    expect(result.success).toBe(false);
    expect(result.summary).toContain("token budget exceeded");
    expect(decisions).toBe(2);
  });

  test("cost budget stops the run", async () => {
    const result = await runLoop({
      task: "spend dollars",
      page: createFakePage(),
      challengeWatchdog: false,
      budget: { maxCostUsd: 0.01 },
      decide: async () => ({
        actions: [{ name: "wait", params: { ms: 1 } }],
        done: false,
        telemetry: {
          model: "claude-sonnet-4-6",
          // 10M input tokens => $30 per decision, blows a 1-cent budget
          usage: { inputTokens: 10_000_000, outputTokens: 0 },
        },
      }),
    });

    expect(result.reason).toBe("budget_exceeded");
    expect(result.summary).toContain("cost budget exceeded");
  });

  test("a done decision over budget still completes", async () => {
    const result = await runLoop({
      task: "finish in one shot",
      page: createFakePage(),
      challengeWatchdog: false,
      budget: { maxTokens: 10 },
      decide: async () => ({
        actions: [{ name: "done", params: { success: true, summary: "All done" } }],
        done: true,
        telemetry: {
          model: "claude-sonnet-4-6",
          usage: { inputTokens: 5_000, outputTokens: 100 },
        },
      }),
    });

    expect(result.success).toBe(true);
    expect(result.reason).toBe("completed");
  });
});
