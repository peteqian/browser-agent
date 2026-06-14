import { describe, expect, test } from "bun:test";

import { estimateCostUsd, resolveModelPricing } from "./pricing";

describe("resolveModelPricing", () => {
  test("exact match", () => {
    expect(resolveModelPricing("claude-sonnet-4-6")).toMatchObject({
      inputPerMTok: 3,
      outputPerMTok: 15,
    });
  });

  test("tolerates provider prefix and date suffix", () => {
    expect(resolveModelPricing("anthropic/claude-sonnet-4-6")?.inputPerMTok).toBe(3);
    expect(resolveModelPricing("claude-haiku-4-5-20251001")?.inputPerMTok).toBe(1);
  });

  test("unknown model returns null", () => {
    expect(resolveModelPricing("mystery-model-9000")).toBeNull();
    expect(resolveModelPricing(undefined)).toBeNull();
  });

  test("custom table wins", () => {
    const table = { "my-model": { inputPerMTok: 2, outputPerMTok: 4 } };
    expect(resolveModelPricing("my-model", table)?.outputPerMTok).toBe(4);
    expect(resolveModelPricing("claude-sonnet-4-6", table)).toBeNull();
  });
});

describe("estimateCostUsd", () => {
  test("computes input + output + cache costs", () => {
    const cost = estimateCostUsd(
      {
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        cachedInputTokens: 1_000_000,
        cacheCreationTokens: 1_000_000,
      },
      "claude-sonnet-4-6",
    );
    // 3 + 1.5 + 0.3 (cache read 0.1x) + 3.75 (cache write 1.25x)
    expect(cost).toBeCloseTo(8.55, 5);
  });

  test("null for unknown model or missing usage", () => {
    expect(estimateCostUsd({ inputTokens: 1, outputTokens: 1 }, "nope")).toBeNull();
    expect(estimateCostUsd(undefined, "claude-sonnet-4-6")).toBeNull();
  });
});
