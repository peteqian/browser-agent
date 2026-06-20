import { describe, expect, test } from "bun:test";

import type { RunReport } from "./report";
import { reportToOtel } from "./otel";

function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    schemaVersion: 1,
    task: "apply to job",
    startedAt: "2026-06-12T00:00:00.000Z",
    finishedAt: "2026-06-12T00:00:10.000Z",
    durationMs: 10_000,
    result: { success: true, reason: "completed", summary: "done", data: null, steps: 1 },
    provider: "claude",
    transport: "sdk-api",
    model: "claude-sonnet-4-6",
    usage: { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 50, cacheCreationTokens: 0 },
    costUsd: 0.0123,
    costIsPartial: false,
    steps: [
      {
        step: 1,
        snapshot: { durationMs: 100, elementCount: 40, bytes: 9000 },
        decision: {
          durationMs: 800,
          inputTokens: 1000,
          outputTokens: 200,
          model: "claude-sonnet-4-6",
          costUsd: 0.0123,
        },
        actions: [
          { name: "click", ok: true, durationMs: 30, message: "Clicked [3]" },
          { name: "type", ok: false, durationMs: 20, message: "stale" },
        ],
      },
    ],
    challenges: [],
    loopNudges: 0,
    ...overrides,
  };
}

describe("reportToOtel", () => {
  test("builds a root span plus step/snapshot/decision/action children", () => {
    const out = reportToOtel(report());
    const root = out.spans.find((s) => s.name === "browser_agent.run");
    expect(root).toBeDefined();
    expect(root?.parentSpanId).toBeUndefined();
    expect(root?.status).toBe("ok");
    expect(root?.attributes.task).toBe("apply to job");
    expect(root?.attributes["cost.usd"]).toBe(0.0123);

    const step = out.spans.find((s) => s.name === "browser_agent.step");
    expect(step?.parentSpanId).toBe(root?.spanId);
    // step has a failed action → step span is error
    expect(step?.status).toBe("error");

    expect(out.spans.some((s) => s.name === "browser_agent.snapshot")).toBe(true);
    expect(out.spans.some((s) => s.name === "browser_agent.decision")).toBe(true);
    const clickSpan = out.spans.find((s) => s.name === "action.click");
    const typeSpan = out.spans.find((s) => s.name === "action.type");
    expect(clickSpan?.status).toBe("ok");
    expect(typeSpan?.status).toBe("error");
    expect(clickSpan?.parentSpanId).toBe(step?.spanId);
  });

  test("all spans share one traceId and have unique spanIds", () => {
    const out = reportToOtel(report());
    const traceIds = new Set(out.spans.map((s) => s.traceId));
    expect(traceIds.size).toBe(1);
    const spanIds = out.spans.map((s) => s.spanId);
    expect(new Set(spanIds).size).toBe(spanIds.length);
    for (const id of spanIds) expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect([...traceIds][0]).toMatch(/^[0-9a-f]{32}$/);
  });

  test("deterministic for the same report", () => {
    const a = reportToOtel(report());
    const b = reportToOtel(report());
    expect(a.spans.map((s) => s.spanId)).toEqual(b.spans.map((s) => s.spanId));
  });

  test("emits token and cost metrics; omits cost when null", () => {
    const out = reportToOtel(report());
    const names = out.metrics.map((m) => m.name);
    expect(names).toContain("browser_agent.tokens.input");
    expect(names).toContain("browser_agent.cost");
    const cost = out.metrics.find((m) => m.name === "browser_agent.cost");
    expect(cost?.value).toBe(0.0123);

    const noCost = reportToOtel(report({ costUsd: null }));
    expect(noCost.metrics.some((m) => m.name === "browser_agent.cost")).toBe(false);
  });

  test("failed run marks the root span error", () => {
    const out = reportToOtel(
      report({
        result: { success: false, reason: "max_failures", summary: "x", data: null, steps: 3 },
      }),
    );
    const root = out.spans.find((s) => s.name === "browser_agent.run");
    expect(root?.status).toBe("error");
    expect(root?.attributes["result.reason"]).toBe("max_failures");
  });
});
