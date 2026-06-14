import { describe, expect, test } from "bun:test";

import { defaultShouldRetry, withRetry } from "./retry";

describe("withRetry", () => {
  test("returns success on first attempt with no retry needed", async () => {
    let calls = 0;
    const result = await withRetry(async () => {
      calls += 1;
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(1);
  });

  test("retries on retryable error and eventually succeeds", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw { status: 429 };
        return "ok";
      },
      { maxAttempts: 5, initialDelayMs: 1, maxDelayMs: 5 },
    );
    expect(result).toBe("ok");
    expect(calls).toBe(3);
  });

  test("does not retry non-retryable error", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw { status: 400 };
        },
        { maxAttempts: 5, initialDelayMs: 1 },
      ),
    ).rejects.toEqual({ status: 400 });
    expect(calls).toBe(1);
  });

  test("rethrows last error after exhausting attempts", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw { status: 429 };
        },
        { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1 },
      ),
    ).rejects.toEqual({ status: 429 });
    expect(calls).toBe(3);
  });

  test("maxAttempts: 1 disables retry", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw { status: 429 };
        },
        { maxAttempts: 1 },
      ),
    ).rejects.toBeDefined();
    expect(calls).toBe(1);
  });

  test("custom shouldRetry overrides default", async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new Error("anything");
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1,
          maxDelayMs: 1,
          shouldRetry: (_err, attempt) => attempt < 2,
        },
      ),
    ).rejects.toBeDefined();
    expect(calls).toBe(2);
  });

  test("onRetry fires for each retry but not the final failure", async () => {
    const events: number[] = [];
    await expect(
      withRetry(
        async () => {
          throw { status: 429 };
        },
        {
          maxAttempts: 3,
          initialDelayMs: 1,
          maxDelayMs: 1,
          onRetry: (info) => events.push(info.attempt),
        },
      ),
    ).rejects.toBeDefined();
    // Two retries scheduled (after attempts 1 and 2). Final attempt 3 fails without scheduling.
    expect(events).toEqual([1, 2]);
  });

  test("aborts the chain when signal fires before next attempt", async () => {
    const controller = new AbortController();
    let calls = 0;
    const promise = withRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          // Abort right after first failure so we don't sleep through the test.
          setTimeout(() => controller.abort(), 5);
        }
        throw { status: 429 };
      },
      { maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 100 },
      controller.signal,
    );
    await expect(promise).rejects.toBeDefined();
    expect(calls).toBeLessThanOrEqual(2);
  });

  test("propagates aborted signal as the thrown error", async () => {
    const controller = new AbortController();
    controller.abort(new Error("user canceled"));
    await expect(
      withRetry(async () => "ok", { maxAttempts: 3 }, controller.signal),
    ).rejects.toThrow(/user canceled/);
  });
});

describe("defaultShouldRetry", () => {
  test("retries on 429", () => {
    expect(defaultShouldRetry({ status: 429 })).toBe(true);
  });

  test("retries on 500-range", () => {
    expect(defaultShouldRetry({ status: 502 })).toBe(true);
    expect(defaultShouldRetry({ status: 599 })).toBe(true);
  });

  test("does not retry on 400/401/403", () => {
    expect(defaultShouldRetry({ status: 400 })).toBe(false);
    expect(defaultShouldRetry({ status: 401 })).toBe(false);
    expect(defaultShouldRetry({ status: 403 })).toBe(false);
  });

  test("retries on transient network codes", () => {
    expect(defaultShouldRetry({ code: "ECONNRESET" })).toBe(true);
    expect(defaultShouldRetry({ code: "ETIMEDOUT" })).toBe(true);
    expect(defaultShouldRetry({ code: "EAI_AGAIN" })).toBe(true);
  });

  test("does not retry AbortError", () => {
    expect(defaultShouldRetry({ name: "AbortError" })).toBe(false);
  });

  test("retries when message mentions rate limit", () => {
    expect(defaultShouldRetry(new Error("Hit rate limit"))).toBe(true);
    expect(defaultShouldRetry(new Error("HTTP 429"))).toBe(true);
  });

  test("does not retry random errors", () => {
    expect(defaultShouldRetry(new Error("type error in code"))).toBe(false);
    expect(defaultShouldRetry(null)).toBe(false);
    expect(defaultShouldRetry(undefined)).toBe(false);
    expect(defaultShouldRetry("string error")).toBe(false);
  });
});
