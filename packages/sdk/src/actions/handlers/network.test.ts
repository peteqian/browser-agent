import { describe, expect, test } from "bun:test";

import { filterNetworkEntries, handleNetworkHarStart, handleNetworkHarStop } from "./network";
import type { HandlerContext } from "./shared";
import type { Page } from "../../browser/page/page";

interface MockHandlers {
  requestWillBeSent?: (p: unknown) => void;
  responseReceived?: (p: unknown) => void;
  loadingFinished?: (p: unknown) => void;
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
        if (method === "Network.requestWillBeSent") handlers.requestWillBeSent = handler;
        else if (method === "Network.responseReceived") handlers.responseReceived = handler;
        else if (method === "Network.loadingFinished") handlers.loadingFinished = handler;
        return () => {};
      },
    },
  } as unknown as Page;
  return { page, handlers, commands };
}

describe("network_har_* handlers", () => {
  test("start enables Network domain and records requests", async () => {
    const { page, handlers, commands } = makeMockPage();
    const ctx: HandlerContext = { page };
    const startResult = await handleNetworkHarStart(ctx, {
      name: "network_har_start",
      params: {},
    });
    expect(startResult.ok).toBe(true);
    expect(commands).toContain("Network.enable");

    handlers.requestWillBeSent?.({
      requestId: "req-1",
      request: { method: "GET", url: "https://example.com/a", headers: {} },
      timestamp: 1,
    });
    handlers.responseReceived?.({
      requestId: "req-1",
      response: { status: 200, headers: {} },
      timestamp: 1.5,
    });
    handlers.loadingFinished?.({ requestId: "req-1", timestamp: 2 });

    const stopResult = await handleNetworkHarStop(ctx, {
      name: "network_har_stop",
      params: {},
    });
    expect(stopResult.ok).toBe(true);
    const data = stopResult.data as { har: { entries: Array<{ request: { url: string } }> } };
    expect(data.har.entries.length).toBe(1);
    expect(data.har.entries[0]?.request.url).toBe("https://example.com/a");
  });

  test("starting twice is idempotent", async () => {
    const { page } = makeMockPage();
    const ctx: HandlerContext = { page };
    await handleNetworkHarStart(ctx, { name: "network_har_start", params: {} });
    const second = await handleNetworkHarStart(ctx, {
      name: "network_har_start",
      params: {},
    });
    expect(second.ok).toBe(true);
    expect(second.message).toMatch(/already/);
    await handleNetworkHarStop(ctx, { name: "network_har_stop", params: {} });
  });

  test("stop without start fails", async () => {
    const { page } = makeMockPage();
    const ctx: HandlerContext = { page };
    const r = await handleNetworkHarStop(ctx, { name: "network_har_stop", params: {} });
    expect(r.ok).toBe(false);
  });
});

describe("filterNetworkEntries", () => {
  type HarEntryShape =
    Parameters<typeof filterNetworkEntries>[0] extends Iterable<infer T> ? T : never;
  function entry(
    overrides: Partial<{
      requestId: string;
      method: string;
      url: string;
      status?: number;
      mimeType?: string;
      durationSec?: number;
    }> = {},
  ): HarEntryShape {
    const status = overrides.status;
    const duration = overrides.durationSec;
    return {
      request: {
        requestId: overrides.requestId ?? "r1",
        method: overrides.method ?? "GET",
        url: overrides.url ?? "https://example.com/a",
        headers: {},
        timestamp: 0,
      },
      response:
        status !== undefined
          ? {
              status,
              statusText: "",
              headers: {},
              mimeType: overrides.mimeType ?? "text/html",
              timestamp: duration ?? 0,
            }
          : undefined,
      timing: { startedAt: 0, completedAt: duration },
    } as HarEntryShape;
  }

  test("returns all entries when filter is empty", () => {
    const r = filterNetworkEntries([entry({ requestId: "1" }), entry({ requestId: "2" })], {});
    expect(r.total).toBe(2);
    expect(r.matched).toBe(2);
    expect(r.entries.length).toBe(2);
  });

  test("urlIncludes is case-insensitive substring", () => {
    const r = filterNetworkEntries(
      [
        entry({ url: "https://API.example.com/users" }),
        entry({ url: "https://example.com/static.js" }),
      ],
      { urlIncludes: "api" },
    );
    expect(r.matched).toBe(1);
    expect(r.entries[0]?.url).toContain("API");
  });

  test("method filter case-insensitive", () => {
    const r = filterNetworkEntries([entry({ method: "POST" }), entry({ method: "GET" })], {
      method: "post",
    });
    expect(r.matched).toBe(1);
    expect(r.entries[0]?.method).toBe("POST");
  });

  test("status bucket filter (4xx)", () => {
    const r = filterNetworkEntries(
      [entry({ status: 200 }), entry({ status: 404 }), entry({ status: 500 })],
      { status: "4xx" },
    );
    expect(r.matched).toBe(1);
    expect(r.entries[0]?.status).toBe(404);
  });

  test("exact status number filter", () => {
    const r = filterNetworkEntries(
      [entry({ status: 200 }), entry({ status: 201 }), entry({ status: 200 })],
      { status: 200 },
    );
    expect(r.matched).toBe(2);
  });

  test("entries without a response are excluded when status filter set", () => {
    const r = filterNetworkEntries([entry({ status: 200 }), entry({})], { status: "2xx" });
    expect(r.matched).toBe(1);
  });

  test("maxResults caps returned entries but matched still counts all", () => {
    const items = Array.from({ length: 10 }, (_, i) => entry({ requestId: `r${i}` }));
    const r = filterNetworkEntries(items, { maxResults: 3 });
    expect(r.total).toBe(10);
    expect(r.matched).toBe(10);
    expect(r.entries.length).toBe(3);
  });

  test("durationMs computed from start/completedAt in seconds", () => {
    const r = filterNetworkEntries([entry({ status: 200, durationSec: 0.25 })], {});
    expect(r.entries[0]?.durationMs).toBe(250);
  });
});
