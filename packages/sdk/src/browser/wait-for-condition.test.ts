import { describe, expect, test } from "bun:test";

import type { Page } from "./page";
import { waitForCondition } from "./page-navigation";

function pageWithSequence(values: readonly unknown[]): { page: Page; calls: string[] } {
  const calls: string[] = [];
  let i = 0;
  const page = {
    evaluate: async (expr: string) => {
      calls.push(expr);
      const v = values[Math.min(i, values.length - 1)];
      i += 1;
      return v;
    },
  } as unknown as Page;
  return { page, calls };
}

describe("waitForCondition", () => {
  test("returns the truthy value on first hit", async () => {
    const { page } = pageWithSequence([true]);
    const value = await waitForCondition(page, "window.ready", 1_000, 10);
    expect(value).toBe(true);
  });

  test("polls until a value becomes truthy", async () => {
    const { page, calls } = pageWithSequence([false, false, 42]);
    const value = await waitForCondition(page, "window.count", 1_000, 5);
    expect(value).toBe(42);
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  test("returns null when the timeout elapses without a truthy value", async () => {
    const { page } = pageWithSequence([false]);
    const value = await waitForCondition(page, "window.never", 30, 10);
    expect(value).toBeNull();
  });

  test("wraps the expression in a try/catch IIFE", async () => {
    const { page, calls } = pageWithSequence([1]);
    await waitForCondition(page, "window.x", 100, 10);
    expect(calls[0]).toContain("try");
    expect(calls[0]).toContain("(window.x)");
  });

  test("evaluate throws are swallowed and retried", async () => {
    let i = 0;
    const page = {
      evaluate: async () => {
        i += 1;
        if (i < 3) throw new Error("page navigating");
        return "ready";
      },
    } as unknown as Page;
    const value = await waitForCondition(page, "window.x", 500, 5);
    expect(value).toBe("ready");
  });
});
