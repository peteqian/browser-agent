import { describe, expect, test } from "bun:test";

import type { NavigationHealthResult, Page } from "../browser/session";
import { executeAction } from "./execute";

function createPageWithNavigation(health: NavigationHealthResult): Page {
  return {
    targetId: "page-1",
    navigateWithHealthCheck: async () => health,
  } as unknown as Page;
}

describe("executeAction navigation watchdog metadata", () => {
  test("includes navigation health data on successful navigate", async () => {
    const health: NavigationHealthResult = {
      ok: true,
      status: "loaded",
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      readyState: "complete",
      durationMs: 12,
    };

    const result = await executeAction(createPageWithNavigation(health), {
      name: "navigate",
      params: { url: "https://example.com/" },
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ navigation: health });
  });

  test("includes navigation health data on failed navigate", async () => {
    const health: NavigationHealthResult = {
      ok: false,
      status: "empty",
      url: "https://example.com/empty",
      finalUrl: "https://example.com/empty",
      readyState: "complete",
      durationMs: 25,
      warning: "Page loaded but returned empty content.",
    };

    const result = await executeAction(createPageWithNavigation(health), {
      name: "navigate",
      params: { url: "https://example.com/empty" },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("page appears empty");
    expect(result.data).toEqual({ navigation: health });
  });

  test("uses navigation health metadata for new_tab URLs", async () => {
    const health: NavigationHealthResult = {
      ok: true,
      status: "loaded",
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      readyState: "complete",
      durationMs: 12,
    };
    const tab = createPageWithNavigation(health);
    const session = {
      newPage: async () => tab,
    };

    const result = await executeAction(
      createPageWithNavigation(health),
      { name: "new_tab", params: { url: "https://example.com/" } },
      session as never,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ navigation: health });
    expect(result.activeTargetId).toBe("page-1");
  });
});
