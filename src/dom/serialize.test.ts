import { describe, expect, test } from "bun:test";

import { formatSnapshotForLLM } from "./serialize";
import type { ElementInfo, PageSnapshot } from "./types";

function makeElement(index: number, text: string): ElementInfo {
  return {
    index,
    backendNodeId: 100 + index,
    framePath: "main",
    tag: "button",
    role: "button",
    text,
    href: null,
    name: null,
    ariaName: null,
    type: null,
    placeholder: null,
    value: null,
    ariaLabel: null,
    selectorHint: `button#b${index}`,
    bbox: { x: 0, y: 0, w: 10, h: 10 },
  };
}

function makeSnapshot(count: number, perTextLength: number): PageSnapshot {
  const text = "x".repeat(perTextLength);
  return {
    url: "https://example.com/",
    title: "T",
    stability: { readyState: "complete", pendingRequestCount: 0 },
    elements: Array.from({ length: count }, (_, i) => makeElement(i, text)),
  };
}

describe("formatSnapshotForLLM budgets", () => {
  test("honors maxDisplayElements", () => {
    const snapshot = makeSnapshot(50, 10);
    const out = formatSnapshotForLLM(snapshot, { maxDisplayElements: 5 });
    const elementLines = out.split("\n").filter((line) => line.startsWith("["));
    expect(elementLines).toHaveLength(5);
    expect(out).toContain("45 more elements truncated");
  });

  test("honors maxTotalChars by truncating with summary footer", () => {
    const snapshot = makeSnapshot(200, 50);
    const out = formatSnapshotForLLM(snapshot, {
      maxDisplayElements: 200,
      maxTotalChars: 500,
    });
    expect(out.length).toBeLessThanOrEqual(700);
    expect(out).toContain("more truncated");
  });

  test("accepts legacy numeric limit argument", () => {
    const snapshot = makeSnapshot(3, 5);
    const out = formatSnapshotForLLM(snapshot, 2);
    const elementLines = out.split("\n").filter((line) => line.startsWith("["));
    expect(elementLines).toHaveLength(2);
  });
});
