import { describe, expect, test } from "bun:test";

import type { Page } from "../browser/session/session";
import type { BrowserStateSummary } from "../browser/state";
import type { ElementInfo } from "../dom/types";
import { SessionRunner } from "./session-runner";

function element(init: {
  index: number;
  backendNodeId: number;
  stableId: string;
  axName?: string;
}): ElementInfo {
  return {
    index: init.index,
    backendNodeId: init.backendNodeId,
    framePath: "main",
    tag: "BUTTON",
    role: "button",
    text: init.axName ?? "Submit",
    href: null,
    name: null,
    ariaName: init.axName ?? "Submit",
    type: null,
    placeholder: null,
    value: null,
    ariaLabel: null,
    selectorHint: "button",
    bbox: { x: 10, y: 10, w: 100, h: 30 },
    axRole: "button",
    axName: init.axName ?? "Submit",
    testId: null,
    dataAttrs: {},
    labelText: null,
    stableHandle: { kind: "role", value: `role=button name="${init.axName ?? "Submit"}"` },
    stableId: init.stableId,
  };
}

function stateWith(elements: ElementInfo[]): BrowserStateSummary {
  return {
    url: "https://example.com/form",
    title: "Form",
    activeTab: "t1",
    tabs: [{ targetId: "t1", active: true }],
    viewport: { width: 1280, height: 900 },
    readyState: "complete",
    pendingRequests: [],
    elements,
    selectorMap: {
      byIndex: new Map(elements.map((el) => [el.index, { backendNodeId: el.backendNodeId }])),
    },
    observation: "",
    snapshot: {
      url: "https://example.com/form",
      title: "Form",
      elements,
      stability: { readyState: "complete", pendingRequestCount: 0 },
    },
    observationIsDiff: false,
  };
}

function fakePage(clickResults: Map<number, boolean>): {
  page: Page;
  clicks: number[];
} {
  const clicks: number[] = [];
  const page = {
    targetId: "t1",
    clickByBackendNodeId: async (backendNodeId: number) => {
      clicks.push(backendNodeId);
      return clickResults.get(backendNodeId) ? { ok: true } : { ok: false, reason: "index_stale" };
    },
  } as unknown as Page;
  return { page, clicks };
}

describe("SessionRunner self-healing", () => {
  test("retries a stale click against the re-located element", async () => {
    const before = stateWith([element({ index: 5, backendNodeId: 100, stableId: "abc" })]);
    const after = stateWith([element({ index: 7, backendNodeId: 200, stableId: "abc" })]);
    const { page, clicks } = fakePage(new Map([[200, true]]));

    const runner = new SessionRunner({ page, latestState: before });
    (runner as unknown as { refresh: () => Promise<BrowserStateSummary> }).refresh = async () => {
      runner.setState(after);
      return after;
    };

    const result = await runner.runAction({ name: "click", params: { index: 5 } });

    expect(result.ok).toBe(true);
    expect(result.message).toContain("self-healed");
    expect(clicks).toEqual([100, 200]);
  });

  test("falls back to semantic tuple when stableId changed", async () => {
    const before = stateWith([
      element({ index: 5, backendNodeId: 100, stableId: "old", axName: "Apply now" }),
    ]);
    const after = stateWith([
      element({ index: 3, backendNodeId: 300, stableId: "new", axName: "Apply now" }),
    ]);
    const { page, clicks } = fakePage(new Map([[300, true]]));

    const runner = new SessionRunner({ page, latestState: before });
    (runner as unknown as { refresh: () => Promise<BrowserStateSummary> }).refresh = async () => {
      runner.setState(after);
      return after;
    };

    const result = await runner.runAction({ name: "click", params: { index: 5 } });
    expect(result.ok).toBe(true);
    expect(clicks).toEqual([100, 300]);
  });

  test("surfaces the original failure when no replacement exists", async () => {
    const before = stateWith([element({ index: 5, backendNodeId: 100, stableId: "abc" })]);
    const after = stateWith([]);
    const { page, clicks } = fakePage(new Map());

    const runner = new SessionRunner({ page, latestState: before });
    (runner as unknown as { refresh: () => Promise<BrowserStateSummary> }).refresh = async () => {
      runner.setState(after);
      return after;
    };

    const result = await runner.runAction({ name: "click", params: { index: 5 } });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("no longer exists");
    expect(clicks).toEqual([100]);
  });

  test("selfHealing: false disables the retry", async () => {
    const before = stateWith([element({ index: 5, backendNodeId: 100, stableId: "abc" })]);
    const { page, clicks } = fakePage(new Map());

    const runner = new SessionRunner({ page, latestState: before, selfHealing: false });
    let refreshed = false;
    (runner as unknown as { refresh: () => Promise<BrowserStateSummary> }).refresh = async () => {
      refreshed = true;
      return before;
    };

    const result = await runner.runAction({ name: "click", params: { index: 5 } });
    expect(result.ok).toBe(false);
    expect(refreshed).toBe(false);
    expect(clicks).toEqual([100]);
  });
});
