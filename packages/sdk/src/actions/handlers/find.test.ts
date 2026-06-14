import { describe, expect, test } from "bun:test";

import { handleFindByRole, handleFindByText, handleFindByTestid } from "./find";
import type { ElementInfo } from "../../dom/types";
import type { HandlerContext } from "./shared";
import type { Page } from "../../browser/page/page";

function mk(overrides: Partial<ElementInfo>): ElementInfo {
  return {
    index: 0,
    backendNodeId: 1,
    framePath: "main",
    tag: "div",
    role: null,
    text: "",
    href: null,
    name: null,
    ariaName: null,
    type: null,
    placeholder: null,
    value: null,
    ariaLabel: null,
    selectorHint: "div",
    bbox: { x: 0, y: 0, w: 100, h: 30 },
    axRole: null,
    axName: null,
    testId: null,
    dataAttrs: {},
    labelText: null,
    stableHandle: { kind: "index", value: "" },
    stableId: "00000000",
    ...overrides,
  };
}

function ctxFor(elements: ElementInfo[]): HandlerContext {
  return {
    page: {} as Page,
    snapshotElements: elements,
  };
}

describe("find_by_* handlers", () => {
  test("find_by_role returns indices matching role", () => {
    const els = [
      mk({ index: 0, axRole: "button", axName: "Search" }),
      mk({ index: 1, axRole: "link", axName: "Home" }),
      mk({ index: 2, axRole: "button", axName: "Submit" }),
    ];
    const r = handleFindByRole(ctxFor(els), {
      name: "find_by_role",
      params: { role: "button" },
    });
    expect(r.ok).toBe(true);
    const data = r.data as { indices: number[] };
    expect(data.indices).toEqual([0, 2]);
  });

  test("find_by_role filters by name when provided", () => {
    const els = [
      mk({ index: 0, axRole: "button", axName: "Search" }),
      mk({ index: 1, axRole: "button", axName: "Submit" }),
    ];
    const r = handleFindByRole(ctxFor(els), {
      name: "find_by_role",
      params: { role: "button", name: "search" },
    });
    expect(r.ok).toBe(true);
    expect((r.data as { indices: number[] }).indices).toEqual([0]);
  });

  test("find_by_text defaults to case-insensitive exact match", () => {
    const els = [
      mk({ index: 0, text: "Hello World" }),
      mk({ index: 1, text: "Hello" }),
      mk({ index: 2, axName: "hello" }),
    ];
    const r = handleFindByText(ctxFor(els), {
      name: "find_by_text",
      params: { text: "hello" },
    });
    expect(r.ok).toBe(true);
    expect((r.data as { indices: number[] }).indices).toEqual([1, 2]);
  });

  test("find_by_text matches substring case-insensitively when partial=true", () => {
    const els = [
      mk({ index: 0, text: "Hello World" }),
      mk({ index: 1, text: "Goodbye" }),
      mk({ index: 2, axName: "Say hello" }),
    ];
    const r = handleFindByText(ctxFor(els), {
      name: "find_by_text",
      params: { text: "hello", partial: true },
    });
    expect(r.ok).toBe(true);
    expect((r.data as { indices: number[] }).indices).toEqual([0, 2]);
  });

  test("find_by_testid exact match", () => {
    const els = [
      mk({ index: 0, testId: "submit" }),
      mk({ index: 1, testId: "cancel" }),
      mk({ index: 2, testId: "submit-secondary" }),
    ];
    const r = handleFindByTestid(ctxFor(els), {
      name: "find_by_testid",
      params: { testid: "submit" },
    });
    expect(r.ok).toBe(true);
    expect((r.data as { indices: number[] }).indices).toEqual([0]);
  });

  test("returns empty indices when no snapshot elements", () => {
    const r = handleFindByText(ctxFor([]), { name: "find_by_text", params: { text: "x" } });
    expect(r.ok).toBe(false);
  });

  test("skips elements with zero bbox", () => {
    const els = [
      mk({ index: 0, testId: "x", bbox: { x: 0, y: 0, w: 0, h: 0 } }),
      mk({ index: 1, testId: "x" }),
    ];
    const r = handleFindByTestid(ctxFor(els), {
      name: "find_by_testid",
      params: { testid: "x" },
    });
    expect(r.ok).toBe(true);
    expect((r.data as { indices: number[] }).indices).toEqual([1]);
  });
});
