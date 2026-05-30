import { describe, expect, test } from "bun:test";

import { diffSnapshots } from "./snapshot-diff";
import type { ElementInfo, PageSnapshot } from "./types";

let nextIndex = 0;
function el(overrides: Partial<ElementInfo> & { stableId: string }): ElementInfo {
  const i = nextIndex++;
  return {
    index: i,
    backendNodeId: 100 + i,
    framePath: "main",
    tag: "button",
    role: "button",
    text: "",
    href: null,
    name: null,
    ariaName: null,
    type: null,
    placeholder: null,
    value: null,
    ariaLabel: null,
    selectorHint: `button#b${i}`,
    bbox: { x: 0, y: 0, w: 10, h: 10 },
    axRole: "button",
    axName: "Item",
    testId: null,
    dataAttrs: {},
    labelText: null,
    stableHandle: { kind: "index", value: "" },
    ...overrides,
  };
}

function snap(elements: ElementInfo[], url = "https://example.com/"): PageSnapshot {
  return {
    url,
    title: "T",
    stability: { readyState: "complete", pendingRequestCount: 0 },
    elements,
  };
}

describe("diffSnapshots", () => {
  test("identical snapshots produce zero churn", () => {
    const a = snap([el({ stableId: "aaa", axName: "A" }), el({ stableId: "bbb", axName: "B" })]);
    const b = snap([el({ stableId: "aaa", axName: "A" }), el({ stableId: "bbb", axName: "B" })]);
    const d = diffSnapshots(a, b);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
    expect(d.unchanged).toBe(2);
  });

  test("pure addition", () => {
    const a = snap([el({ stableId: "aaa", axName: "A" })]);
    const b = snap([el({ stableId: "aaa", axName: "A" }), el({ stableId: "ccc", axName: "C" })]);
    const d = diffSnapshots(a, b);
    expect(d.added.map((e) => e.stableId)).toEqual(["ccc"]);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
    expect(d.unchanged).toBe(1);
  });

  test("pure removal", () => {
    const a = snap([el({ stableId: "aaa", axName: "A" }), el({ stableId: "bbb", axName: "B" })]);
    const b = snap([el({ stableId: "aaa", axName: "A" })]);
    const d = diffSnapshots(a, b);
    expect(d.added).toHaveLength(0);
    expect(d.removed.map((e) => e.stableId)).toEqual(["bbb"]);
    expect(d.changed).toHaveLength(0);
    expect(d.unchanged).toBe(1);
  });

  test("name change is reported as changed, not added/removed", () => {
    const a = snap([el({ stableId: "aaa", axName: "Old" })]);
    const b = snap([el({ stableId: "aaa", axName: "New" })]);
    const d = diffSnapshots(a, b);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]?.next.axName).toBe("New");
    expect(d.unchanged).toBe(0);
  });

  test("role change makes stableId differ so it shows as add+remove", () => {
    // Different stableIds simulate a role shift (different hash inputs).
    const a = snap([el({ stableId: "aaa", axRole: "button", axName: "Go" })]);
    const b = snap([el({ stableId: "ddd", axRole: "link", axName: "Go" })]);
    const d = diffSnapshots(a, b);
    expect(d.removed.map((e) => e.stableId)).toEqual(["aaa"]);
    expect(d.added.map((e) => e.stableId)).toEqual(["ddd"]);
    expect(d.changed).toHaveLength(0);
    expect(d.unchanged).toBe(0);
  });

  test("falls back to framePath+role+name tuple when stableId missing", () => {
    const a = snap([el({ stableId: "", axName: "Match", text: "old" })]);
    const b = snap([el({ stableId: "", axName: "Match", text: "new" })]);
    const d = diffSnapshots(a, b);
    expect(d.changed).toHaveLength(1);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
  });

  test("high-churn case still reports correct buckets", () => {
    // 4 elements removed, 4 added, 1 unchanged => >50% churn (caller handles cap).
    const a = snap([
      el({ stableId: "a1", axName: "A1" }),
      el({ stableId: "a2", axName: "A2" }),
      el({ stableId: "a3", axName: "A3" }),
      el({ stableId: "a4", axName: "A4" }),
      el({ stableId: "keep", axName: "Keep" }),
    ]);
    const b = snap([
      el({ stableId: "b1", axName: "B1" }),
      el({ stableId: "b2", axName: "B2" }),
      el({ stableId: "b3", axName: "B3" }),
      el({ stableId: "b4", axName: "B4" }),
      el({ stableId: "keep", axName: "Keep" }),
    ]);
    const d = diffSnapshots(a, b);
    expect(d.added).toHaveLength(4);
    expect(d.removed).toHaveLength(4);
    expect(d.unchanged).toBe(1);
    const churn = d.added.length + d.removed.length + d.changed.length;
    expect(churn / b.elements.length).toBeGreaterThan(0.5);
  });
});
