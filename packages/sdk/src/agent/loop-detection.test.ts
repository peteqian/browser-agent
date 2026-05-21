import { describe, expect, test } from "bun:test";

import { canonicaliseActionCall, detectRepeatedAction, detectSameNameRun } from "./loop-detection";

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

describe("detectSameNameRun", () => {
  test("returns null when threshold not met", () => {
    expect(detectSameNameRun(["eval", "eval", "eval"], 4)).toBeNull();
  });

  test("returns the trailing run name + count at threshold", () => {
    const r = detectSameNameRun(["click", "eval", "eval", "eval", "eval"], 4);
    expect(r).toEqual({ name: "eval", count: 4 });
  });

  test("counts only trailing identical names", () => {
    const r = detectSameNameRun(["eval", "click", "eval", "eval", "eval", "eval"], 4);
    expect(r).toEqual({ name: "eval", count: 4 });
  });

  test("returns null when the latest action differs from prior run", () => {
    expect(detectSameNameRun(["eval", "eval", "eval", "click"], 3)).toBeNull();
  });

  test("returns null on empty input", () => {
    expect(detectSameNameRun([], 1)).toBeNull();
  });
});
