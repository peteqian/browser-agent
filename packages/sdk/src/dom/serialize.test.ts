import { describe, expect, test } from "bun:test";

import { formatSnapshotDiff, formatSnapshotForLLM } from "./serialize";
import type { ElementInfo, PageSnapshot } from "./types";

function makeElement(
  index: number,
  text: string,
  overrides: Partial<ElementInfo> = {},
): ElementInfo {
  const base: ElementInfo = {
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
    axRole: "button",
    axName: text,
    testId: null,
    dataAttrs: {},
    labelText: null,
    stableHandle: { kind: "index", value: "" },
    stableId: "00000000",
  };
  return { ...base, ...overrides };
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

const ELEMENT_LINE = /^@e\d+ \[[^\]]+\] "/;

describe("formatSnapshotForLLM budgets", () => {
  test("honors maxDisplayElements", () => {
    const snapshot = makeSnapshot(50, 10);
    const out = formatSnapshotForLLM(snapshot, { maxDisplayElements: 5 });
    const elementLines = out.split("\n").filter((line) => ELEMENT_LINE.test(line));
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
    const elementLines = out.split("\n").filter((line) => ELEMENT_LINE.test(line));
    expect(elementLines).toHaveLength(2);
  });

  test("stays under 8 KB on an 80-element snapshot with default budgets", () => {
    const snapshot: PageSnapshot = {
      url: "https://example.com/",
      title: "Big page",
      stability: { readyState: "complete", pendingRequestCount: 0 },
      elements: Array.from({ length: 80 }, (_, i) =>
        makeElement(i, `Item ${i} ${"y".repeat(40)}`, {
          tag: i % 2 === 0 ? "button" : "a",
          axRole: i % 2 === 0 ? "button" : "link",
          href: i % 2 === 0 ? null : `/item/${i}`,
        }),
      ),
    };
    const out = formatSnapshotForLLM(snapshot);
    expect(out.length).toBeLessThanOrEqual(8_000);
  });
});

describe("renderElementLine shape", () => {
  test('renders @e<index> [<role>] "<name>" with no extras for a plain button', () => {
    const snapshot: PageSnapshot = {
      url: "https://example.com/",
      title: "T",
      stability: { readyState: "complete", pendingRequestCount: 0 },
      elements: [makeElement(7, "Search", { axRole: "button", axName: "Search" })],
    };
    const out = formatSnapshotForLLM(snapshot);
    expect(out).toContain('@e7 [button] "Search"');
  });

  test("prefers value, then placeholder for inputs", () => {
    const valueInput = makeElement(1, "", {
      tag: "input",
      axRole: "textbox",
      axName: null,
      type: "text",
      placeholder: "Email",
      value: "me@example.com",
    });
    const placeholderInput = makeElement(2, "", {
      tag: "input",
      axRole: "textbox",
      axName: null,
      type: "text",
      placeholder: "Email",
      value: null,
    });
    const snapshot: PageSnapshot = {
      url: "https://example.com/",
      title: "T",
      stability: { readyState: "complete", pendingRequestCount: 0 },
      elements: [valueInput, placeholderInput],
    };
    const out = formatSnapshotForLLM(snapshot);
    expect(out).toContain('@e1 [textbox] "me@example.com"');
    expect(out).toContain('@e2 [textbox] "Email"');
  });

  test("appends state suffixes for checked/disabled/expanded/selected", () => {
    const snapshot: PageSnapshot = {
      url: "https://example.com/",
      title: "T",
      stability: { readyState: "complete", pendingRequestCount: 0 },
      elements: [
        makeElement(1, "Remember me", {
          tag: "input",
          axRole: "checkbox",
          axName: "Remember me",
          type: "checkbox",
          dataAttrs: { "aria-checked": "true" },
        }),
        makeElement(2, "Submit", {
          axRole: "button",
          axName: "Submit",
          dataAttrs: { disabled: "" },
        }),
        makeElement(3, "Menu", {
          axRole: "button",
          axName: "Menu",
          dataAttrs: { "aria-expanded": "false" },
        }),
        makeElement(4, "Tab one", {
          axRole: "tab",
          axName: "Tab one",
          dataAttrs: { "aria-selected": "true" },
        }),
      ],
    };
    const out = formatSnapshotForLLM(snapshot);
    expect(out).toContain('@e1 [checkbox] "Remember me"[checked]');
    expect(out).toContain('@e2 [button] "Submit"[disabled]');
    expect(out).toContain('@e3 [button] "Menu"[expanded=false]');
    expect(out).toContain('@e4 [tab] "Tab one"[selected]');
  });

  test("includes href only for nameless links", () => {
    const namedLink = makeElement(1, "Listing", {
      tag: "a",
      axRole: "link",
      axName: "Listing",
      href: "/listings/1",
    });
    const namelessLink = makeElement(2, "", {
      tag: "a",
      axRole: "link",
      axName: null,
      text: "",
      href: "/listings/2",
    });
    const snapshot: PageSnapshot = {
      url: "https://example.com/",
      title: "T",
      stability: { readyState: "complete", pendingRequestCount: 0 },
      elements: [namedLink, namelessLink],
    };
    const out = formatSnapshotForLLM(snapshot);
    expect(out).toContain('@e1 [link] "Listing"');
    expect(out).not.toMatch(/@e1 \[link\] "Listing" href=/);
    expect(out).toContain('@e2 [link] "" href="/listings/2"');
  });

  test("falls back to tag when axRole is absent", () => {
    const snapshot: PageSnapshot = {
      url: "https://example.com/",
      title: "T",
      stability: { readyState: "complete", pendingRequestCount: 0 },
      elements: [
        makeElement(1, "Hello", { axRole: null, axName: "Hello", tag: "summary", role: null }),
      ],
    };
    const out = formatSnapshotForLLM(snapshot);
    expect(out).toContain('@e1 [summary] "Hello"');
  });

  test("does not emit a FORMS DETECTED prelude", () => {
    const snapshot: PageSnapshot = {
      url: "https://example.com/",
      title: "T",
      stability: { readyState: "complete", pendingRequestCount: 0 },
      elements: [
        makeElement(1, "", {
          tag: "input",
          axRole: "textbox",
          axName: "Destination",
          type: "text",
          bbox: { x: 10, y: 200, w: 200, h: 30 },
        }),
      ],
    };
    const out = formatSnapshotForLLM(snapshot);
    expect(out).not.toContain("FORMS DETECTED");
  });
});

describe("formatSnapshotDiff", () => {
  function snap(elements: ElementInfo[], url = "https://example.com/"): PageSnapshot {
    return {
      url,
      title: "T",
      stability: { readyState: "complete", pendingRequestCount: 0 },
      elements,
    };
  }

  test("renders + / ~ / - markers and unchanged count", () => {
    // 8 unchanged keeps churn (3/10) below the 50% cap.
    const keepers = Array.from({ length: 8 }, (_, i) =>
      makeElement(10 + i, `Stay${i}`, { stableId: `s${i}`, axName: `Stay${i}` }),
    );
    const prev = snap([
      ...keepers,
      makeElement(0, "Old", { stableId: "x", axName: "Old" }),
      makeElement(2, "Drop", { stableId: "d", axName: "Drop" }),
    ]);
    const next = snap([
      ...keepers,
      makeElement(1, "New", { stableId: "x", axName: "New" }),
      makeElement(3, "Add", { stableId: "a", axName: "Add" }),
    ]);
    const out = formatSnapshotDiff(prev, next);
    expect(out.usedDiff).toBe(true);
    expect(out.text).toContain("SNAPSHOT DIFF vs prior step: +1 added, -1 removed, ~1 changed");
    expect(out.text).toMatch(/\+ @e3 \[button\] "Add"/);
    expect(out.text).toContain("- @e2");
    expect(out.text).toMatch(/~ @e1 \[button\] "New"/);
    expect(out.text).toContain("(= 8 unchanged)");
  });

  test("URL change forces fallback to full snapshot", () => {
    const prev = snap([makeElement(0, "X", { stableId: "h" })], "https://a.example/");
    const next = snap([makeElement(0, "X", { stableId: "h" })], "https://b.example/");
    const out = formatSnapshotDiff(prev, next);
    expect(out.usedDiff).toBe(false);
    expect(out.text).toContain("INTERACTIVE ELEMENTS");
  });

  test("null prev falls back to full snapshot", () => {
    const next = snap([makeElement(0, "X", { stableId: "h" })]);
    const out = formatSnapshotDiff(null, next);
    expect(out.usedDiff).toBe(false);
    expect(out.text).toContain("INTERACTIVE ELEMENTS");
  });

  test(">50% churn falls back to full snapshot", () => {
    const prev = snap([
      makeElement(0, "", { stableId: "a", axName: "A" }),
      makeElement(1, "", { stableId: "b", axName: "B" }),
    ]);
    const next = snap([
      makeElement(0, "", { stableId: "c", axName: "C" }),
      makeElement(1, "", { stableId: "d", axName: "D" }),
      makeElement(2, "", { stableId: "e", axName: "E" }),
    ]);
    const out = formatSnapshotDiff(prev, next);
    expect(out.usedDiff).toBe(false);
    expect(out.text).toContain("INTERACTIVE ELEMENTS");
  });

  test("pure addition only renders + lines", () => {
    const prev = snap([makeElement(0, "Keep", { stableId: "k", axName: "Keep" })]);
    const next = snap([
      makeElement(0, "Keep", { stableId: "k", axName: "Keep" }),
      makeElement(1, "Plus", { stableId: "p", axName: "Plus" }),
    ]);
    const out = formatSnapshotDiff(prev, next);
    expect(out.usedDiff).toBe(true);
    expect(out.text).toMatch(/\+ @e1 \[button\] "Plus"/);
    expect(out.text).not.toMatch(/^- /m);
    expect(out.text).not.toMatch(/^~ /m);
  });

  test("pure removal only renders - lines", () => {
    const keepers = Array.from({ length: 4 }, (_, i) =>
      makeElement(10 + i, `Stay${i}`, { stableId: `s${i}`, axName: `Stay${i}` }),
    );
    const prev = snap([...keepers, makeElement(1, "Gone", { stableId: "g", axName: "Gone" })]);
    const next = snap(keepers);
    const out = formatSnapshotDiff(prev, next);
    expect(out.usedDiff).toBe(true);
    expect(out.text).toContain("- @e1");
    expect(out.text).not.toMatch(/^\+ /m);
    expect(out.text).not.toMatch(/^~ /m);
  });

  test("honors maxDisplayElements for rendered diff lines", () => {
    const keepers = Array.from({ length: 8 }, (_, i) =>
      makeElement(10 + i, `Stay${i}`, { stableId: `s${i}`, axName: `Stay${i}` }),
    );
    const prev = snap(keepers);
    const next = snap([
      ...keepers,
      makeElement(1, "Add one", { stableId: "a1", axName: "Add one" }),
      makeElement(2, "Add two", { stableId: "a2", axName: "Add two" }),
      makeElement(3, "Add three", { stableId: "a3", axName: "Add three" }),
    ]);
    const out = formatSnapshotDiff(prev, next, { maxDisplayElements: 2 });

    expect(out.usedDiff).toBe(true);
    const diffLines = out.text.split("\n").filter((line) => /^[+~-] /.test(line));
    expect(diffLines).toHaveLength(2);
    expect(out.text).toContain("... 1 diff entries truncated");
    expect(out.text).toContain("(= 8 unchanged)");
  });

  test("falls back to full snapshot when diff exceeds maxTotalChars", () => {
    const keepers = Array.from({ length: 8 }, (_, i) =>
      makeElement(10 + i, `Stay${i}`, { stableId: `s${i}`, axName: `Stay${i}` }),
    );
    const prev = snap(keepers);
    const next = snap([
      ...keepers,
      makeElement(1, "Changed", {
        stableId: "c1",
        axName: "Changed " + "x".repeat(100),
      }),
    ]);
    const out = formatSnapshotDiff(prev, next, {
      maxDisplayElements: 20,
      maxTotalChars: 120,
    });

    expect(out.usedDiff).toBe(false);
    expect(out.text).toContain("INTERACTIVE ELEMENTS");
    expect(out.text).toContain("more truncated");
  });
});
