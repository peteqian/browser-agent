import { describe, expect, test } from "bun:test";

import type { Page } from "../browser/session";
import type { BrowserStateSummary } from "../browser/state";
import { SessionRunner } from "./session-runner";
import { RateLimiter } from "./rate-limit";

// Minimal state so index-based actions resolve (index 0 → backendNodeId 0).
function stateWithIndex0(): BrowserStateSummary {
  return {
    url: "https://x.com/a",
    title: "",
    activeTab: "page-1",
    tabs: [{ targetId: "page-1", active: true }],
    viewport: { width: 1280, height: 900 },
    readyState: "complete",
    pendingRequests: [],
    elements: [],
    selectorMap: { byIndex: new Map([[0, { backendNodeId: 0 }]]) },
    observation: "",
    snapshot: {
      url: "",
      title: "",
      elements: [],
      stability: { readyState: "complete", pendingRequestCount: 0 },
    },
    observationIsDiff: false,
  };
}

function clickPage(opts: { url?: string; afterUrl?: string; clickOk?: boolean }): {
  page: Page;
  calls: string[];
} {
  const calls: string[] = [];
  let url = opts.url ?? "https://x.com/a";
  const page = {
    targetId: "page-1",
    clickByBackendNodeId: async () => {
      calls.push("click");
      if (opts.afterUrl) url = opts.afterUrl;
      return { ok: opts.clickOk ?? true };
    },
    currentUrl: async () => url,
    evaluate: async () => 0,
  } as unknown as Page;
  return { page, calls };
}

describe("SessionRunner post-condition", () => {
  test("downgrades a successful action when url did not change", async () => {
    const { page } = clickPage({ url: "https://x.com/a" });
    const runner = new SessionRunner({ page, latestState: stateWithIndex0() });
    const result = await runner.runAction(
      { name: "click", params: { index: 0 } },
      { currentUrl: "https://x.com/a", postCondition: { type: "url_changed" } },
    );
    expect(result.ok).toBe(false);
    expect(result.message).toContain("post-condition failed");
  });

  test("keeps success when url changed as expected", async () => {
    const { page } = clickPage({ url: "https://x.com/a", afterUrl: "https://x.com/thanks" });
    const runner = new SessionRunner({ page, latestState: stateWithIndex0() });
    const result = await runner.runAction(
      { name: "click", params: { index: 0 } },
      { currentUrl: "https://x.com/a", postCondition: { type: "url_contains", value: "thanks" } },
    );
    expect(result.ok).toBe(true);
  });

  test("does not run the post-condition on an already-failed action", async () => {
    const { page } = clickPage({ clickOk: false });
    const runner = new SessionRunner({ page, selfHealing: false, latestState: stateWithIndex0() });
    const result = await runner.runAction(
      { name: "click", params: { index: 0 } },
      { postCondition: { type: "url_changed" } },
    );
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain("post-condition");
  });
});

describe("SessionRunner rate limiting", () => {
  test("acquires from the limiter before each action", async () => {
    const acquired: Array<string | undefined> = [];
    const limiter = new RateLimiter({ perActionMs: 100 }, { now: () => 0, sleep: async () => {} });
    const original = limiter.acquire.bind(limiter);
    limiter.acquire = async (host?: string) => {
      acquired.push(host);
      return original(host);
    };
    const { page } = clickPage({ url: "https://jobs.example.com/a" });
    const runner = new SessionRunner({ page, rateLimit: limiter, latestState: stateWithIndex0() });
    await runner.runAction(
      { name: "click", params: { index: 0 } },
      { currentUrl: "https://jobs.example.com/a" },
    );
    expect(acquired).toEqual(["jobs.example.com"]);
  });
});
