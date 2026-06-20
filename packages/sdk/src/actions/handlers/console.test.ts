import { describe, expect, test } from "bun:test";

import type { BrowserSession } from "../../browser/session/session";
import type { Page } from "../../browser/page/page";
import { handleConsoleRead, handleConsoleStart, handleConsoleStop } from "./console";
import type { HandlerContext } from "./shared";

interface Listener {
  event: string;
  fn: (p: unknown) => void;
}

function makePage(): { page: Page; listeners: Listener[] } {
  const listeners: Listener[] = [];
  const session = {
    onTargetEvent: async (_targetId: string, event: string, fn: (p: unknown) => void) => {
      listeners.push({ event, fn });
      return () => {
        const i = listeners.findIndex((l) => l.event === event && l.fn === fn);
        if (i >= 0) listeners.splice(i, 1);
      };
    },
  } as unknown as BrowserSession;
  const page = { targetId: "p1", session } as unknown as Page;
  return { page, listeners };
}

describe("console capture", () => {
  test("start subscribes to consoleAPICalled + exceptionThrown", async () => {
    const { page, listeners } = makePage();
    await handleConsoleStart({ page } as HandlerContext, { name: "console_start", params: {} });
    expect(listeners.map((l) => l.event).toSorted()).toEqual([
      "Runtime.consoleAPICalled",
      "Runtime.exceptionThrown",
    ]);
  });

  test("starting twice is idempotent", async () => {
    const { page, listeners } = makePage();
    const ctx = { page } as HandlerContext;
    await handleConsoleStart(ctx, { name: "console_start", params: {} });
    const r = await handleConsoleStart(ctx, { name: "console_start", params: {} });
    expect(r.message).toContain("already in progress");
    expect(listeners.length).toBe(2);
  });

  test("read returns buffered entries with text joined from args", async () => {
    const { page, listeners } = makePage();
    const ctx = { page } as HandlerContext;
    await handleConsoleStart(ctx, { name: "console_start", params: {} });
    const apiListener = listeners.find((l) => l.event === "Runtime.consoleAPICalled")?.fn;
    apiListener?.({
      type: "log",
      args: [{ value: "hello" }, { value: 42 }],
      timestamp: 1,
    });
    apiListener?.({ type: "error", args: [{ description: "BOOM" }], timestamp: 2 });
    const r = handleConsoleRead(ctx, { name: "console_read", params: {} });
    expect(r.ok).toBe(true);
    const data = r.data as { entries: Array<{ level: string; text: string }>; total: number };
    expect(data.total).toBe(2);
    expect(data.entries[0]?.level).toBe("log");
    expect(data.entries[0]?.text).toBe("hello 42");
    expect(data.entries[1]?.level).toBe("error");
  });

  test("level filter normalizes warn -> warning", async () => {
    const { page, listeners } = makePage();
    const ctx = { page } as HandlerContext;
    await handleConsoleStart(ctx, { name: "console_start", params: {} });
    const apiListener = listeners.find((l) => l.event === "Runtime.consoleAPICalled")?.fn;
    apiListener?.({ type: "warning", args: [{ value: "w" }], timestamp: 1 });
    apiListener?.({ type: "log", args: [{ value: "l" }], timestamp: 2 });
    const r = handleConsoleRead(ctx, { name: "console_read", params: { level: "warn" } });
    const data = r.data as { entries: Array<{ level: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.entries[0]?.level).toBe("warning");
  });

  test("read with clear=true empties the buffer", async () => {
    const { page, listeners } = makePage();
    const ctx = { page } as HandlerContext;
    await handleConsoleStart(ctx, { name: "console_start", params: {} });
    listeners
      .find((l) => l.event === "Runtime.consoleAPICalled")
      ?.fn?.({
        type: "log",
        args: [{ value: "x" }],
        timestamp: 1,
      });
    handleConsoleRead(ctx, { name: "console_read", params: { clear: true } });
    const after = handleConsoleRead(ctx, { name: "console_read", params: {} });
    expect((after.data as { total: number }).total).toBe(0);
  });

  test("read fails when no capture is active", () => {
    const { page } = makePage();
    const r = handleConsoleRead({ page } as HandlerContext, {
      name: "console_read",
      params: {},
    });
    expect(r.ok).toBe(false);
  });

  test("exceptionThrown emits an exception-level entry", async () => {
    const { page, listeners } = makePage();
    const ctx = { page } as HandlerContext;
    await handleConsoleStart(ctx, { name: "console_start", params: {} });
    const excListener = listeners.find((l) => l.event === "Runtime.exceptionThrown")?.fn;
    excListener?.({
      exceptionDetails: {
        text: "Uncaught TypeError",
        url: "https://x/y.js",
        lineNumber: 12,
        exception: { description: "TypeError: foo is not a function" },
      },
      timestamp: 1,
    });
    const data = handleConsoleRead(ctx, { name: "console_read", params: {} }).data as {
      entries: Array<{ level: string; text: string }>;
    };
    expect(data.entries[0]?.level).toBe("exception");
    expect(data.entries[0]?.text).toContain("TypeError");
  });

  test("stop unsubscribes and returns count", async () => {
    const { page, listeners } = makePage();
    const ctx = { page } as HandlerContext;
    await handleConsoleStart(ctx, { name: "console_start", params: {} });
    listeners
      .find((l) => l.event === "Runtime.consoleAPICalled")
      ?.fn?.({
        type: "log",
        args: [{ value: "x" }],
        timestamp: 1,
      });
    const r = handleConsoleStop(ctx, { name: "console_stop", params: {} });
    expect(r.ok).toBe(true);
    expect((r.data as { totalCaptured: number }).totalCaptured).toBe(1);
    expect(listeners.length).toBe(0);
  });
});
