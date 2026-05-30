import { describe, expect, test } from "bun:test";

import { buildTelemetry } from "./telemetry";

describe("buildTelemetry", () => {
  test("computes latencyMs from startedAt", () => {
    const startedAt = Date.now() - 50;
    const tel = buildTelemetry(startedAt, "gpt-4");
    expect(tel.latencyMs).toBeGreaterThanOrEqual(50);
    expect(tel.model).toBe("gpt-4");
  });

  test("passes through usage when provided", () => {
    const tel = buildTelemetry(Date.now(), "claude-3", {
      inputTokens: 100,
      outputTokens: 200,
      cachedInputTokens: 50,
    });
    expect(tel.usage).toEqual({
      inputTokens: 100,
      outputTokens: 200,
      cachedInputTokens: 50,
    });
  });

  test("usage undefined when omitted", () => {
    const tel = buildTelemetry(Date.now(), "claude-3");
    expect(tel.usage).toBeUndefined();
  });
});
