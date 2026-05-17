import { describe, expect, test } from "bun:test";

import { canonicaliseActionCall, detectRepeatedAction } from "./loop-detection";

describe("canonicaliseActionCall", () => {
  test("strips index and nth so cosmetic differences collapse", () => {
    expect(canonicaliseActionCall("click", { index: 1 })).toBe(
      canonicaliseActionCall("click", { index: 99 }),
    );
    expect(canonicaliseActionCall("click_by", { locator: { role: "button", nth: 0 } })).toBe(
      canonicaliseActionCall("click_by", { locator: { role: "button", nth: 5 } }),
    );
  });

  test("preserves discriminating params", () => {
    expect(canonicaliseActionCall("click_by", { locator: { role: "button" } })).not.toBe(
      canonicaliseActionCall("click_by", { locator: { role: "link" } }),
    );
  });

  test("orders keys stably", () => {
    expect(canonicaliseActionCall("type", { text: "hi", submit: true })).toBe(
      canonicaliseActionCall("type", { submit: true, text: "hi" }),
    );
  });
});

describe("detectRepeatedAction", () => {
  test("returns null when fewer than 2 calls or last calls differ", () => {
    expect(detectRepeatedAction([])).toBeNull();
    expect(detectRepeatedAction(["a"])).toBeNull();
    expect(detectRepeatedAction(["a", "b"])).toBeNull();
  });

  test("counts consecutive trailing repeats", () => {
    const res = detectRepeatedAction(["a", "a", "a"]);
    expect(res).toEqual({ fingerprint: "a", count: 3 });
  });

  test("stops at non-matching prefix", () => {
    const res = detectRepeatedAction(["b", "a", "a"]);
    expect(res).toEqual({ fingerprint: "a", count: 2 });
  });
});
