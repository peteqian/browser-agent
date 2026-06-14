import { describe, expect, test } from "bun:test";

import type { ElementInfo, PageSnapshot } from "../../dom/types";
import type { Page } from "./page";
import { screenshot } from "./page-output";

interface CdpCall {
  method: string;
  params: Record<string, unknown>;
}

function makePage(): { page: Page; calls: CdpCall[] } {
  const calls: CdpCall[] = [];
  const mock = {
    async sendCDP<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
      calls.push({ method, params });
      if (method === "Page.captureScreenshot") return { data: "FAKE_PNG_BASE64" } as T;
      return { result: { value: true } } as T;
    },
  };
  return { page: mock as unknown as Page, calls };
}

function makeElement(index: number, x: number, y: number, w: number, h: number): ElementInfo {
  return {
    index,
    backendNodeId: 1000 + index,
    framePath: "main",
    tag: "button",
    role: null,
    text: `el${index}`,
    href: null,
    name: null,
    ariaName: null,
    type: null,
    placeholder: null,
    value: null,
    ariaLabel: null,
    selectorHint: "button",
    bbox: { x, y, w, h },
    axRole: "button",
    axName: `el${index}`,
    testId: null,
    dataAttrs: {},
    labelText: null,
    stableHandle: { kind: "index", value: String(index) },
    stableId: String(index),
  };
}

function makeSnapshot(elements: ElementInfo[]): PageSnapshot {
  return {
    url: "https://example.com",
    title: "Example",
    elements,
    stability: { readyState: "complete", pendingRequestCount: 0 },
  };
}

describe("screenshot annotation", () => {
  test("returns plain screenshot when annotate is false", async () => {
    const { page, calls } = makePage();
    const data = await screenshot(page);
    expect(data).toBe("FAKE_PNG_BASE64");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("Page.captureScreenshot");
  });

  test("injects overlay container, captures, and cleans up", async () => {
    const { page, calls } = makePage();
    const snapshot = makeSnapshot([
      makeElement(0, 10, 20, 100, 30),
      makeElement(1, 50, 80, 40, 40),
    ]);
    const data = await screenshot(page, { annotate: true, snapshot });
    expect(data).toBe("FAKE_PNG_BASE64");

    const methods = calls.map((c) => c.method);
    expect(methods).toEqual(["Runtime.evaluate", "Page.captureScreenshot", "Runtime.evaluate"]);

    const injectExpr = String(calls[0]?.params.expression ?? "");
    expect(injectExpr).toContain("__ba_annotations__");
    expect(injectExpr).toContain("'[' + item.index + ']'");
    expect(injectExpr).toContain('"index":0');
    expect(injectExpr).toContain('"index":1');

    const cleanupExpr = String(calls[2]?.params.expression ?? "");
    expect(cleanupExpr).toContain("__ba_annotations__");
    expect(cleanupExpr).toContain("remove()");
  });

  test("filters elements by annotateIndices", async () => {
    const { page, calls } = makePage();
    const snapshot = makeSnapshot([
      makeElement(0, 0, 0, 10, 10),
      makeElement(1, 5, 5, 10, 10),
      makeElement(2, 10, 10, 10, 10),
    ]);
    await screenshot(page, { annotate: true, snapshot, annotateIndices: [1] });

    const injectExpr = String(calls[0]?.params.expression ?? "");
    expect(injectExpr).toContain('"index":1');
    expect(injectExpr).not.toContain('"index":0');
    expect(injectExpr).not.toContain('"index":2');
  });

  test("runs cleanup even when capture throws", async () => {
    const calls: CdpCall[] = [];
    const mock = {
      async sendCDP<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
        calls.push({ method, params });
        if (method === "Page.captureScreenshot") throw new Error("boom");
        return { result: { value: true } } as T;
      },
    };
    const page = mock as unknown as Page;
    const snapshot = makeSnapshot([makeElement(0, 0, 0, 10, 10)]);

    await expect(screenshot(page, { annotate: true, snapshot })).rejects.toThrow("boom");
    expect(calls.map((c) => c.method)).toEqual([
      "Runtime.evaluate",
      "Page.captureScreenshot",
      "Runtime.evaluate",
    ]);
  });
});
