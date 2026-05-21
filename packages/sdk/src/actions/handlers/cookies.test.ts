import { describe, expect, test } from "bun:test";

import type { Page } from "../../browser/page";
import { handleCookiesClear, handleCookiesGet, handleCookiesSet } from "./cookies";
import type { HandlerContext } from "./shared";

function fakePage(impl: Record<string, (params?: unknown) => unknown>): {
  page: Page;
  calls: Array<{ method: string; params: unknown }>;
} {
  const calls: Array<{ method: string; params: unknown }> = [];
  const page = {
    sendCDP: async (method: string, params: unknown) => {
      calls.push({ method, params });
      return impl[method]?.(params) ?? {};
    },
  } as unknown as Page;
  return { page, calls };
}

describe("handleCookiesGet", () => {
  test("returns all cookies when no urls filter", async () => {
    const { page } = fakePage({
      "Storage.getCookies": () => ({
        cookies: [
          {
            name: "a",
            value: "1",
            domain: "example.com",
            path: "/",
            secure: false,
            httpOnly: false,
          },
          { name: "b", value: "2", domain: "other.com", path: "/", secure: false, httpOnly: false },
        ],
      }),
    });
    const r = await handleCookiesGet({ page } as HandlerContext, {
      name: "cookies_get",
      params: {},
    });
    expect(r.ok).toBe(true);
    expect((r.data as { total: number }).total).toBe(2);
  });

  test("filters cookies by url host", async () => {
    const { page } = fakePage({
      "Storage.getCookies": () => ({
        cookies: [
          {
            name: "a",
            value: "1",
            domain: ".example.com",
            path: "/",
            secure: false,
            httpOnly: false,
          },
          { name: "b", value: "2", domain: "other.com", path: "/", secure: false, httpOnly: false },
        ],
      }),
    });
    const r = await handleCookiesGet({ page } as HandlerContext, {
      name: "cookies_get",
      params: { urls: ["https://example.com/"] },
    });
    const data = r.data as { cookies: Array<{ name: string }> };
    expect(data.cookies.length).toBe(1);
    expect(data.cookies[0]?.name).toBe("a");
  });

  test("maxResults caps returned cookies", async () => {
    const { page } = fakePage({
      "Storage.getCookies": () => ({
        cookies: Array.from({ length: 10 }, (_, i) => ({
          name: `c${i}`,
          value: "x",
          domain: "example.com",
          path: "/",
          secure: false,
          httpOnly: false,
        })),
      }),
    });
    const r = await handleCookiesGet({ page } as HandlerContext, {
      name: "cookies_get",
      params: { maxResults: 3 },
    });
    const data = r.data as { total: number; cookies: unknown[] };
    expect(data.total).toBe(10);
    expect(data.cookies.length).toBe(3);
  });

  test("CDP failure surfaces a deterministic fail", async () => {
    const page = {
      sendCDP: async () => {
        throw new Error("bad");
      },
    } as unknown as Page;
    const r = await handleCookiesGet({ page } as HandlerContext, {
      name: "cookies_get",
      params: {},
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Failed to read cookies");
  });
});

describe("handleCookiesSet", () => {
  test("forwards cookies to Storage.setCookies", async () => {
    const { page, calls } = fakePage({});
    const r = await handleCookiesSet({ page } as HandlerContext, {
      name: "cookies_set",
      params: {
        cookies: [
          { name: "session", value: "abc", url: "https://example.com/" },
          { name: "tracker", value: "z", domain: ".example.com", path: "/" },
        ],
      },
    });
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("Storage.setCookies");
    const params = calls[0]?.params as { cookies: unknown[] } | undefined;
    expect(params?.cookies.length).toBe(2);
  });
});

describe("handleCookiesClear", () => {
  test("calls Storage.clearCookies", async () => {
    const { page, calls } = fakePage({});
    const r = await handleCookiesClear({ page } as HandlerContext, {
      name: "cookies_clear",
      params: {},
    });
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("Storage.clearCookies");
  });
});
