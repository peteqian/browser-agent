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
    axRole: null,
    axName: null,
    testId: null,
    dataAttrs: {},
    labelText: null,
    stableHandle: { kind: "index", value: "" },
    stableId: "00000000",
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
    const elementLines = out.split("\n").filter((line) => /\[\d+\]#[0-9a-f]{8}$/.test(line));
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
    const elementLines = out.split("\n").filter((line) => /\[\d+\]#[0-9a-f]{8}$/.test(line));
    expect(elementLines).toHaveLength(2);
  });
});

function makeInput(index: number, opts: Partial<ElementInfo> = {}): ElementInfo {
  const base: ElementInfo = {
    index,
    backendNodeId: 200 + index,
    framePath: "main",
    tag: "input",
    role: "textbox",
    text: "",
    href: null,
    name: null,
    ariaName: null,
    type: "text",
    placeholder: null,
    value: null,
    ariaLabel: null,
    selectorHint: `input#i${index}`,
    bbox: { x: 0, y: 0, w: 200, h: 30 },
    axRole: null,
    axName: null,
    testId: null,
    dataAttrs: {},
    labelText: null,
    stableHandle: { kind: "index", value: "" },
    stableId: "00000000",
  };
  const merged = { ...base, ...opts };
  if (!opts.stableHandle && opts.ariaLabel) {
    merged.stableHandle = { kind: "label", value: `placeholder="${opts.ariaLabel}"` };
    merged.placeholder = opts.ariaLabel ?? null;
  }
  return merged;
}

describe("formatSnapshotForLLM form prelude", () => {
  test("emits a FORMS DETECTED block when inputs are present", () => {
    const snapshot: PageSnapshot = {
      url: "https://example.com/",
      title: "T",
      stability: { readyState: "complete", pendingRequestCount: 0 },
      elements: [
        makeInput(1, { ariaLabel: "Destination", bbox: { x: 10, y: 200, w: 200, h: 30 } }),
        makeInput(2, {
          tag: "button",
          role: "button",
          text: "Search",
          type: "submit",
          bbox: { x: 220, y: 200, w: 80, h: 30 },
        }),
      ],
    };
    const out = formatSnapshotForLLM(snapshot);
    expect(out).toContain("FORMS DETECTED");
    expect(out).toContain("form#1");
    expect(out).toMatch(/placeholder="Destination" <input\/text>.*\[1\]/);
    expect(out).toMatch(/<button\/submit>.*\[2\]/);
  });

  test("clusters distant fields into separate forms", () => {
    const snapshot: PageSnapshot = {
      url: "https://example.com/",
      title: "T",
      stability: { readyState: "complete", pendingRequestCount: 0 },
      elements: [
        makeInput(1, { ariaLabel: "Search", bbox: { x: 0, y: 100, w: 200, h: 30 } }),
        makeInput(2, { ariaLabel: "Email", bbox: { x: 0, y: 800, w: 200, h: 30 } }),
      ],
    };
    const out = formatSnapshotForLLM(snapshot);
    expect(out).toMatch(/FORMS DETECTED \(2\)/);
  });

  test("skips hidden inputs and zero-sized elements", () => {
    const snapshot: PageSnapshot = {
      url: "https://example.com/",
      title: "T",
      stability: { readyState: "complete", pendingRequestCount: 0 },
      elements: [
        makeInput(1, { type: "hidden", ariaLabel: "csrf" }),
        makeInput(2, { ariaLabel: "X", bbox: { x: 0, y: 0, w: 0, h: 0 } }),
      ],
    };
    const out = formatSnapshotForLLM(snapshot);
    expect(out).not.toContain("FORMS DETECTED");
  });
});
