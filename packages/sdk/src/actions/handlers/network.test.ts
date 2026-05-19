import { describe, expect, test } from "bun:test";

import { handleNetworkHarStart, handleNetworkHarStop } from "./network";
import type { HandlerContext } from "./shared";
import type { Page } from "../../browser/page";

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
