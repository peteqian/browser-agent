import { describe, expect, test } from "bun:test";

import { handleProfilerStart, handleProfilerStop } from "./profiler";
import type { HandlerContext } from "./shared";
import type { Page } from "../../browser/page/page";

interface MockHandlers {
  dataCollected?: (p: unknown) => void;
  tracingComplete?: (p: unknown) => void;
}

function makeMockPage(): { page: Page; handlers: MockHandlers; commands: string[] } {
  const handlers: MockHandlers = {};
  const commands: string[] = [];
  const page = {
    targetId: "mock-target",
    sendCDP: async (method: string) => {
      commands.push(method);
      return {};
    },
    session: {
      onTargetEvent: async (
        _targetId: string,
        method: string,
        handler: (p: unknown) => void,
      ): Promise<() => void> => {
        if (method === "Tracing.dataCollected") handlers.dataCollected = handler;
        else if (method === "Tracing.tracingComplete") handlers.tracingComplete = handler;
        return () => {};
      },
    },
  } as unknown as Page;
  return { page, handlers, commands };
}

describe("profiler_* handlers", () => {
  test("start enables Tracing and stop returns buffered trace events", async () => {
    const { page, handlers, commands } = makeMockPage();
    const ctx: HandlerContext = { page };
    const startResult = await handleProfilerStart(ctx, {
      name: "profiler_start",
      params: {},
    });
    expect(startResult.ok).toBe(true);
    expect(commands).toContain("Tracing.start");

    handlers.dataCollected?.({
      value: [
        { name: "evt-a", ph: "X", ts: 1 },
        { name: "evt-b", ph: "X", ts: 2 },
      ],
    });

    // Simulate Tracing.end completing immediately by firing tracingComplete
    // shortly after stop is called. We schedule it on the next microtask.
    const stopPromise = handleProfilerStop(ctx, {
      name: "profiler_stop",
      params: {},
    });
    queueMicrotask(() => handlers.tracingComplete?.({}));
    const stopResult = await stopPromise;

    expect(stopResult.ok).toBe(true);
    expect(commands).toContain("Tracing.end");
    const data = stopResult.data as {
      trace: { traceEvents: unknown[]; metadata: Record<string, unknown> };
    };
    expect(data.trace.traceEvents.length).toBe(2);
    expect(data.trace.metadata).toBeDefined();
  });

  test("starting twice is idempotent", async () => {
    const { page, handlers } = makeMockPage();
    const ctx: HandlerContext = { page };
    await handleProfilerStart(ctx, { name: "profiler_start", params: {} });
    const second = await handleProfilerStart(ctx, {
      name: "profiler_start",
      params: {},
    });
    expect(second.ok).toBe(true);
    expect(second.message).toMatch(/already/);
    queueMicrotask(() => handlers.tracingComplete?.({}));
    await handleProfilerStop(ctx, { name: "profiler_stop", params: {} });
  });

  test("stop without start fails", async () => {
    const { page } = makeMockPage();
    const ctx: HandlerContext = { page };
    const r = await handleProfilerStop(ctx, { name: "profiler_stop", params: {} });
    expect(r.ok).toBe(false);
  });
});
