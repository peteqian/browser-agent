import { describe, expect, test } from "bun:test";

import { resolveByLocator } from "./shared";
import type { ElementInfo } from "../../dom/types";

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

describe("resolveByLocator", () => {
  test("matches by testid with priority over text", () => {
    const els = [
      mk({ index: 0, tag: "button", testId: "primary-search", text: "Search" }),
      mk({ index: 1, tag: "button", text: "Search" }),
    ];
    const r = resolveByLocator({ testid: "primary-search" }, els);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.element.index).toBe(0);
  });

  test("returns ambiguous when role+name resolves to >1", () => {
    const els = [
      mk({ index: 0, tag: "button", axRole: "button", axName: "Search" }),
      mk({ index: 1, tag: "button", axRole: "button", axName: "Search" }),
    ];
    const r = resolveByLocator({ role: "button", name: "Search" }, els);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("ambiguous");
  });

  test("nth disambiguates ambiguous matches", () => {
    const els = [
      mk({ index: 0, tag: "button", axRole: "button", axName: "Search" }),
      mk({ index: 1, tag: "button", axRole: "button", axName: "Search" }),
    ];
    const r = resolveByLocator({ role: "button", name: "Search", nth: 1 }, els);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.element.index).toBe(1);
  });

  test("returns no_match with suggestions when nothing matches", () => {
    const els = [
      mk({ index: 0, axRole: "textbox", axName: "Email address" }),
      mk({ index: 1, axRole: "textbox", axName: "Password" }),
    ];
    const r = resolveByLocator({ role: "textbox", name: "Username" }, els);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("no_match");
  });

  test("ladder stops at first rung with a match", () => {
    const els = [
      mk({ index: 0, testId: "checkout", tag: "button", axRole: "button", axName: "Pay" }),
      mk({ index: 1, tag: "button", axRole: "button", axName: "Pay" }),
    ];
    // testid resolves uniquely → role rung never inspected
    const r = resolveByLocator({ testid: "checkout", role: "button", name: "Pay" }, els);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.element.index).toBe(0);
  });

  test("href exact match", () => {
    const els = [
      mk({ index: 0, tag: "a", href: "/listings/123" }),
      mk({ index: 1, tag: "a", href: "/listings/456" }),
    ];
    const r = resolveByLocator({ href: "/listings/456" }, els);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.element.index).toBe(1);
  });

  test("label match via labelText", () => {
    const els = [
      mk({ index: 0, tag: "input", labelText: "Email address" }),
      mk({ index: 1, tag: "input", labelText: "Password" }),
    ];
    const r = resolveByLocator({ label: "Email address" }, els);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.element.index).toBe(0);
  });

  test("empty locator returns no_match", () => {
    const r = resolveByLocator({}, [mk({})]);
    expect(r.ok).toBe(false);
  });
});
