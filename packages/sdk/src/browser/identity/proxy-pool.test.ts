import { describe, expect, test } from "bun:test";

import { ProxyPool, resolveProxyLaunch } from "./proxy-pool";

describe("ProxyPool", () => {
  test("round-robin cycles through entries", () => {
    const pool = new ProxyPool({
      proxies: ["http://a:1", "http://b:2", "http://c:3"],
    });
    expect([pool.next(), pool.next(), pool.next(), pool.next()].map((p) => p.server)).toEqual([
      "http://a:1",
      "http://b:2",
      "http://c:3",
      "http://a:1",
    ]);
  });

  test("random uses the injected rng", () => {
    const pool = new ProxyPool({
      proxies: ["http://a:1", "http://b:2", "http://c:3"],
      strategy: "random",
      rng: () => 0.99,
    });
    expect(pool.next().server).toBe("http://c:3");
  });

  test("sticky-per-host keeps the same proxy for a host", () => {
    const pool = new ProxyPool({
      proxies: ["http://a:1", "http://b:2"],
      strategy: "sticky-per-host",
    });
    const first = pool.next("greenhouse.io");
    const second = pool.next("greenhouse.io");
    const other = pool.next("workday.com");
    expect(first.server).toBe(second.server);
    expect(other.server).not.toBe(first.server);
  });

  test("rejects an empty pool", () => {
    expect(() => new ProxyPool({ proxies: [] })).toThrow();
    expect(() => new ProxyPool({ proxies: ["  "] })).toThrow();
  });

  test("toLaunchOptions maps server + bypass", () => {
    expect(ProxyPool.toLaunchOptions({ server: "http://a:1", bypass: "*.local" })).toEqual({
      proxyServer: "http://a:1",
      proxyBypass: "*.local",
    });
  });
});

describe("resolveProxyLaunch", () => {
  test("returns {} without a pool", () => {
    expect(resolveProxyLaunch(undefined, "https://x.com")).toEqual({});
  });

  test("resolves sticky proxy by target host", () => {
    const pool = new ProxyPool({
      proxies: ["http://a:1", "http://b:2"],
      strategy: "sticky-per-host",
    });
    const r1 = resolveProxyLaunch(pool, "https://jobs.example.com/apply");
    const r2 = resolveProxyLaunch(pool, "https://jobs.example.com/other");
    expect(r1.proxyServer).toBe(r2.proxyServer);
  });
});
