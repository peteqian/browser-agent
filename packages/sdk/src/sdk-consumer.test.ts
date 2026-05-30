import { afterEach, describe, expect, test } from "bun:test";

import { BrowserSession, runTask, type GetNextActionFn, type Page, type StepInfo } from "./index";

const testSessions = new Set<{ close: () => Promise<void>; closed: boolean }>();

function createSdkPage(overrides: Partial<Page> = {}): Page {
  const page = {
    targetId: "page-1",
    waitForStablePage: async () => {},
    getPendingNetworkRequests: async () => [],
    evaluate: async () => ({ readyState: "complete", pendingRequestCount: 0 }),
    sendCDP: async (method: string) => {
      if (method === "Accessibility.getFullAXTree") return { nodes: [] };
      if (method === "DOMSnapshot.captureSnapshot") return { documents: [], strings: [] };
      return {};
    },
    ...overrides,
  };

  return page as unknown as Page;
}

function createSdkSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  const closeOverride = overrides.close;
  const session = {
    listPageTargetIds: async () => ["page-1"],
    close: async () => {
      tracked.closed = true;
      if (closeOverride) {
        await closeOverride.call(session);
      }
    },
    ...overrides,
  };
  const tracked = session as unknown as { close: () => Promise<void>; closed: boolean };
  tracked.closed = false;
  testSessions.add(tracked);

  return session as unknown as BrowserSession;
}

afterEach(async () => {
  for (const session of testSessions) {
    if (!session.closed) {
      await session.close();
    }
  }
  testSessions.clear();
});

describe("public SDK consumer", () => {
  test("can run an agent from the public entry point and close the browser", async () => {
    let closed = false;
    const steps: StepInfo[] = [];
    const decide: GetNextActionFn = async (input) => {
      expect(input.task).toBe("Use the SDK and close the browser");
      expect(input.activeTab).toBe("page-1");
      return {
        done: false,
        actions: [{ name: "close_browser", params: {} }],
      };
    };

    const result = await runTask({
      task: "Use the SDK and close the browser",
      page: createSdkPage(),
      session: createSdkSession({
        close: async () => {
          closed = true;
        },
      }),
      getNextAction: decide,
      onStep: (step) => steps.push(step),
    });

    expect(closed).toBe(true);
    expect(result).toEqual({
      success: true,
      reason: "completed",
      summary: "Closed browser session",
      data: null,
      steps: 1,
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.action.name).toBe("close_browser");
  });
});

const runHeadedSmoke = process.env.BROWSER_AGENT_SDK_HEADED_SMOKE === "1";
const smokeUrl = process.env.BROWSER_AGENT_SDK_SMOKE_URL;
const headedSmokeTest = runHeadedSmoke ? test : test.skip;

describe("public SDK smoke", () => {
  headedSmokeTest(
    "opens a live headed browser, optionally navigates, then closes it",
    async () => {
      const session = await BrowserSession.launch({
        headless: false,
        maxRetries: 1,
      });

      try {
        const page = await session.newPage();
        if (smokeUrl) {
          await page.goto(smokeUrl, "domcontentloaded");
        }
        expect(page.targetId).toBeString();
      } finally {
        await session.close().catch(() => {
          // Best-effort cleanup for local smoke runs.
        });
      }
    },
    30_000,
  );
});
