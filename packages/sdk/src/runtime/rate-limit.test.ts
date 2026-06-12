import { describe, expect, test } from "bun:test";

import { RateLimiter, hostOf } from "./rate-limit";

function fakeClock() {
  let t = 1000;
  const slept: number[] = [];
  return {
    slept,
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe("RateLimiter", () => {
  test("disabled when no limits set", async () => {
    const limiter = new RateLimiter({});
    expect(limiter.enabled).toBe(false);
    expect(await limiter.acquire("x.com")).toBe(0);
  });

  test("per-action enforces a minimum gap", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perActionMs: 500 }, clock);
    expect(await limiter.acquire()).toBe(0); // first is free
    expect(await limiter.acquire()).toBe(500); // immediately after → wait full gap
    clock.advance(200);
    expect(await limiter.acquire()).toBe(300); // 200 elapsed → wait the remaining 300
  });

  test("per-host tracks hosts independently", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perHostMs: 1000 }, clock);
    expect(await limiter.acquire("a.com")).toBe(0);
    expect(await limiter.acquire("b.com")).toBe(0); // different host, no wait
    expect(await limiter.acquire("a.com")).toBe(1000); // same host, full gap
  });

  test("takes the max of per-action and per-host waits", async () => {
    const clock = fakeClock();
    const limiter = new RateLimiter({ perActionMs: 200, perHostMs: 800 }, clock);
    await limiter.acquire("a.com");
    expect(await limiter.acquire("a.com")).toBe(800);
  });
});

describe("hostOf", () => {
  test("extracts host, tolerates junk", () => {
    expect(hostOf("https://jobs.example.com/apply")).toBe("jobs.example.com");
    expect(hostOf("not a url")).toBeUndefined();
    expect(hostOf(undefined)).toBeUndefined();
  });
});
