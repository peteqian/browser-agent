import { describe, expect, test } from "bun:test";

import { compactHistory } from "./loop";

const entry = (i: number) => ({ action: `step${i}`, result: `result${i}` });

describe("compactHistory", () => {
  test("returns the input unchanged when total <= head + tail", () => {
    const history = Array.from({ length: 6 }, (_, i) => entry(i));
    expect(compactHistory(history, 2, 8)).toEqual(history);
    expect(compactHistory(history, 2, 4)).toEqual(history);
  });

  test("inserts a marker entry between head and tail when over the budget", () => {
    const history = Array.from({ length: 15 }, (_, i) => entry(i));
    const compacted = compactHistory(history, 2, 8);

    expect(compacted).toHaveLength(11);
    expect(compacted.slice(0, 2)).toEqual([entry(0), entry(1)]);
    expect(compacted[2]).toEqual({
      action: "...",
      result: "(5 earlier steps omitted)",
    });
    expect(compacted.slice(3)).toEqual(history.slice(-8));
  });

  test("singular vs plural in the marker", () => {
    const history = Array.from({ length: 11 }, (_, i) => entry(i));
    const compacted = compactHistory(history, 2, 8);
    expect(compacted[2]).toEqual({
      action: "...",
      result: "(1 earlier step omitted)",
    });
  });

  test("head=0 drops the head slice but keeps the marker", () => {
    const history = Array.from({ length: 12 }, (_, i) => entry(i));
    const compacted = compactHistory(history, 0, 8);
    expect(compacted).toHaveLength(9);
    expect(compacted[0]).toEqual({
      action: "...",
      result: "(4 earlier steps omitted)",
    });
    expect(compacted.slice(1)).toEqual(history.slice(-8));
  });

  test("non-integer or negative inputs are coerced to safe values", () => {
    const history = Array.from({ length: 12 }, (_, i) => entry(i));
    expect(compactHistory(history, -3, 5)).toEqual(compactHistory(history, 0, 5));
    expect(compactHistory(history, 1.7, 4.2)).toEqual(compactHistory(history, 1, 4));
    // tail floor of 1 — never zero out the recent window
    expect(compactHistory(history, 0, 0)).toEqual(compactHistory(history, 0, 1));
  });
});
