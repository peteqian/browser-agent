import { describe, expect, test } from "bun:test";

import type { BrowserEvent } from "./events";
import type { BrowserPermissionGrant } from "./profile";
import { BrowserEventBus } from "./events";
import { BrowserSession, Page } from "./session";
import { reconnectIfNeeded } from "./session-reconnect";
import { configurePermissions } from "./session-setup";
import type { CDPClient } from "../cdp/client";

function createNavigationPage(options: {
  finalUrl?: string;
  readyState?: string;
  navigate?: () => Promise<unknown> | unknown;
}): { page: Page; events: BrowserEvent[] } {
  const eventBus = new BrowserEventBus();
  const events: BrowserEvent[] = [];
  eventBus.on((event) => {
    events.push(event);
  });

  const session = {
    eventBus,
    sendToTarget: async (_targetId: string, method: string, params?: Record<string, unknown>) => {
      if (method === "Page.navigate") return options.navigate?.() ?? {};
      if (method !== "Runtime.evaluate") {
        throw new Error(`Unexpected method: ${method}`);
      }

      const expression = String(params?.expression ?? "");
      if (expression === "document.readyState") {
        return { result: { value: options.readyState ?? "complete" } };
      }
      if (expression === "location.href") {
        return { result: { value: options.finalUrl ?? "about:blank" } };
      }
      throw new Error(`Unexpected expression: ${expression}`);
    },
  } as unknown as BrowserSession;

  return { page: new Page(session, "page-1"), events };
}

describe("Page navigation watchdog", () => {
  test("emits navigation_watchdog event for health-checked navigation", async () => {
    const { page, events } = createNavigationPage({});
    const result = await page.navigateWithHealthCheck("about:blank");

    expect(result.ok).toBe(true);
    expect(result.status).toBe("loaded");
    expect(result.finalUrl).toBe("about:blank");

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      type: "browser_event",
      name: "navigation_watchdog",
      targetId: "page-1",
      data: result,
    });
  });

  test("returns and emits cdp_error health when navigation fails", async () => {
    const { page, events } = createNavigationPage({
      readyState: "loading",
      navigate: () => {
        throw new Error("CDP error -32000: cannot navigate");
      },
    });
    const result = await page.navigateWithHealthCheck("https://example.com/");

    expect(result.ok).toBe(false);
    expect(result.status).toBe("cdp_error");
    expect(result.warning).toContain("cannot navigate");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "browser_event",
      name: "navigation_watchdog",
      targetId: "page-1",
      data: result,
    });
  });

  test("returns cdp_error health when Page.navigate reports errorText", async () => {
    const { page, events } = createNavigationPage({
      navigate: () => ({ errorText: "net::ERR_NAME_NOT_RESOLVED" }),
    });
    const result = await page.navigateWithHealthCheck("https://missing.invalid/");

    expect(result.ok).toBe(false);
    expect(result.status).toBe("cdp_error");
    expect(result.warning).toContain("net::ERR_NAME_NOT_RESOLVED");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "browser_event",
      name: "navigation_watchdog",
      targetId: "page-1",
      data: result,
    });
  });
});

describe("BrowserSession reconnect watchdog", () => {
  test("constructs remote CDP sessions without local launch ownership", () => {
    const session = new BrowserSession({
      cdpUrl: "ws://127.0.0.1:9222/devtools/browser/test",
      profile: { reconnectOnDisconnect: false },
    });

    expect(session.profile.cdpUrl).toBe("ws://127.0.0.1:9222/devtools/browser/test");
    expect(session.profile.isRemoteConnection()).toBe(true);
    expect(session.profile.isManagedLocal()).toBe(false);
    expect(session.profile.reconnectOnDisconnect).toBe(false);
  });

  test("emits cdp_reconnect_failed when reconnect is disabled", async () => {
    const session = new BrowserSession({
      profile: { cdpUrl: "ws://127.0.0.1:1/devtools/browser/test", reconnectOnDisconnect: false },
    });
    const events: BrowserEvent[] = [];
    session.eventBus.on((event) => {
      events.push(event);
    });

    await reconnectIfNeeded(session);

    expect(events).toContainEqual({
      type: "browser_event",
      name: "cdp_reconnect_failed",
      data: { reason: "reconnect_disabled", maxAttempts: 6 },
    });
  });

  test("emits reconnect attempt and failure events after exhausting attempts", async () => {
    const session = new BrowserSession({
      profile: {
        cdpUrl: "ws://127.0.0.1:1/devtools/browser/test",
        reconnectMaxAttempts: 1,
        reconnectBaseDelayMs: 1,
        reconnectMaxDelayMs: 1,
      },
    });
    const events: BrowserEvent[] = [];
    session.eventBus.on((event) => {
      events.push(event);
    });

    await reconnectIfNeeded(session);

    const browserEvents = events.filter((event) => event.type === "browser_event");
    expect(browserEvents).toContainEqual({
      type: "browser_event",
      name: "cdp_reconnect_started",
      data: { maxAttempts: 1, managedLocal: false },
    });
    expect(browserEvents).toContainEqual({
      type: "browser_event",
      name: "cdp_reconnect_attempt",
      data: { attempt: 1, maxAttempts: 1, managedLocal: false },
    });
    expect(browserEvents.some((event) => event.name === "cdp_reconnect_attempt_failed")).toBe(true);
    expect(browserEvents).toContainEqual({
      type: "browser_event",
      name: "cdp_reconnect_failed",
      data: { reason: "max_attempts_exhausted", maxAttempts: 1 },
    });
  });
});

describe("BrowserSession permissions watchdog", () => {
  test("maps launch permission grants into the profile", () => {
    const permissionGrants: BrowserPermissionGrant[] = [
      { origin: "https://example.com", permissions: ["geolocation"] },
    ];
    const session = new BrowserSession({ launch: { permissionGrants } });

    expect(session.profile.permissionGrants).toEqual(permissionGrants);
  });

  test("preserves profile permission grants when launch options are also provided", () => {
    const permissionGrants: BrowserPermissionGrant[] = [
      { origin: "https://example.com", permissions: ["geolocation"] },
    ];
    const session = new BrowserSession({
      profile: { permissionGrants },
      launch: { headless: true },
    });

    expect(session.profile.permissionGrants).toEqual(permissionGrants);
  });

  test("copies permission grants during profile construction", () => {
    const permissionGrants: BrowserPermissionGrant[] = [
      { origin: "https://example.com", permissions: ["geolocation"] },
    ];
    const session = new BrowserSession({ profile: { permissionGrants } });

    permissionGrants[0]!.permissions.push("notifications");

    expect(session.profile.permissionGrants).toEqual([
      { origin: "https://example.com", permissions: ["geolocation"] },
    ]);
  });

  test("grants configured permissions and emits enabled events", async () => {
    const session = new BrowserSession({
      profile: {
        permissionGrants: [
          { origin: "https://example.com", permissions: ["geolocation", "notifications"] },
          { permissions: [] },
        ],
      },
    });
    const commands: Array<{ method: string; params: Record<string, unknown> }> = [];
    const client = {
      send: async (method: string, params: Record<string, unknown>) => {
        commands.push({ method, params });
      },
    };

    await configurePermissions(client as unknown as CDPClient, session.profile, session.eventBus);

    expect(commands).toEqual([
      {
        method: "Browser.grantPermissions",
        params: { origin: "https://example.com", permissions: ["geolocation", "notifications"] },
      },
    ]);
    expect(session.eventBus.history).toContainEqual({
      type: "browser_event",
      name: "permissions_watchdog_enabled",
      data: { origin: "https://example.com", permissions: ["geolocation", "notifications"] },
    });
  });

  test("emits browser_error when permission grants fail", async () => {
    const session = new BrowserSession({
      profile: { permissionGrants: [{ permissions: ["geolocation"] }] },
    });
    const error = new Error("permission grant failed");
    const client = {
      send: async () => {
        throw error;
      },
    };

    await configurePermissions(client as unknown as CDPClient, session.profile, session.eventBus);

    expect(session.eventBus.history).toContainEqual({
      type: "browser_event",
      name: "permissions_watchdog_failed",
      data: { permissions: ["geolocation"], origin: undefined, error: "permission grant failed" },
    });
    expect(session.eventBus.history).toContainEqual({
      type: "browser_error",
      message: "Failed to configure permission grants",
      error,
    });
  });
});

describe("Page backendNodeId actions", () => {
  function createActionPage(
    handler: (method: string, params: Record<string, unknown>) => unknown,
  ): {
    page: Page;
    calls: Array<{ method: string; params: Record<string, unknown> }>;
  } {
    const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
    const session = {
      eventBus: new BrowserEventBus(),
      sendToTarget: async (
        _targetId: string,
        method: string,
        params: Record<string, unknown> = {},
      ) => {
        calls.push({ method, params });
        return handler(method, params);
      },
    } as unknown as BrowserSession;
    return { page: new Page(session, "page-1"), calls };
  }

  test("clickByBackendNodeId resolves node and calls click function", async () => {
    const { page, calls } = createActionPage((method) => {
      if (method === "DOM.resolveNode") return { object: { objectId: "obj-99" } };
      if (method === "Runtime.callFunctionOn") return { result: {} };
      if (method === "Runtime.releaseObject") return {};
      throw new Error(`Unexpected method: ${method}`);
    });

    const result = await page.clickByBackendNodeId(42);
    expect(result).toEqual({ ok: true });
    const resolve = calls.find((c) => c.method === "DOM.resolveNode");
    expect(resolve?.params).toEqual({ backendNodeId: 42 });
    const call = calls.find((c) => c.method === "Runtime.callFunctionOn");
    expect(call?.params.objectId).toBe("obj-99");
    expect(calls.some((c) => c.method === "Runtime.releaseObject")).toBe(true);
  });

  test("clickByBackendNodeId returns index_stale when resolveNode fails", async () => {
    const { page } = createActionPage((method) => {
      if (method === "DOM.resolveNode") throw new Error("No node with given id");
      return {};
    });

    const result = await page.clickByBackendNodeId(42);
    expect(result).toEqual({ ok: false, reason: "index_stale" });
  });
});

describe("BrowserSession storage state config", () => {
  test("maps launch storage state options into the profile", () => {
    const session = new BrowserSession({
      launch: { storageStatePath: ".browser-agent/state.json", saveStorageStateOnClose: false },
    });

    expect(session.profile.storageStatePath).toBe(".browser-agent/state.json");
    expect(session.profile.saveStorageStateOnClose).toBe(false);
  });

  test("defaults saveStorageStateOnClose when storageStatePath is explicit", () => {
    const session = new BrowserSession({
      profile: { storageStatePath: ".browser-agent/state.json" },
    });

    expect(session.profile.saveStorageStateOnClose).toBe(true);
  });
});
