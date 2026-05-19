import { describe, expect, test } from "bun:test";

import type { AgentEvent } from "@peteqian/browser-agent-sdk";

import { SummaryCollector, renderSummary } from "./summary";

describe("SummaryCollector", () => {
  test("aggregates per-step timings from events", () => {
    const events: AgentEvent[] = [
      { type: "snapshot_started", stepIndex: 1 },
      { type: "snapshot_captured", stepIndex: 1, durationMs: 200, elementCount: 10, bytes: 500 },
      { type: "decision_started", stepIndex: 1, provider: "openai", model: "gpt" },
      { type: "decision_completed", stepIndex: 1, durationMs: 8000 },
      { type: "action_started", stepIndex: 1, action: "navigate" },
      { type: "action_completed", stepIndex: 1, action: "navigate", durationMs: 100, ok: true },

      { type: "snapshot_captured", stepIndex: 2, durationMs: 400, elementCount: 8, bytes: 700 },
      { type: "decision_completed", stepIndex: 2, durationMs: 6000 },
      { type: "action_completed", stepIndex: 2, action: "click", durationMs: 50, ok: false },
    ];
    const collector = new SummaryCollector();
    for (const e of events) collector.observe(e);
    const steps = collector.snapshot();
    expect(steps.length).toBe(2);
    expect(steps[0]).toEqual({
      step: 1,
      decisionMs: 8000,
      snapshotMs: 200,
      actionMs: 100,
      action: "navigate",
      ok: true,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
    expect(steps[1]).toEqual({
      step: 2,
      decisionMs: 6000,
      snapshotMs: 400,
      actionMs: 50,
      action: "click",
      ok: false,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
    });
  });

  test("aggregates cache tokens from decision_completed events", () => {
    const events: AgentEvent[] = [
      {
        type: "decision_completed",
        stepIndex: 1,
        durationMs: 1000,
        cacheReadTokens: 0,
        cacheCreationTokens: 4200,
      },
      {
        type: "decision_completed",
        stepIndex: 2,
        durationMs: 800,
        cacheReadTokens: 4200,
        cacheCreationTokens: 0,
      },
    ];
    const collector = new SummaryCollector();
    for (const e of events) collector.observe(e);
    const steps = collector.snapshot();
    expect(steps[0]?.cacheCreationTokens).toBe(4200);
    expect(steps[1]?.cacheReadTokens).toBe(4200);
  });
});

describe("renderSummary", () => {
  test("renders an ASCII table with totals", () => {
    const table = renderSummary([
      {
        step: 1,
        decisionMs: 8000,
        snapshotMs: 200,
        actionMs: 100,
        action: "navigate",
        ok: true,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
      {
        step: 2,
        decisionMs: 6000,
        snapshotMs: 400,
        actionMs: 50,
        action: "click",
        ok: false,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ]);
    expect(table).toContain("step");
    expect(table).toContain("decision");
    expect(table).toContain("snapshot");
    expect(table).toContain("navigate");
    expect(table).toContain("click");
    expect(table).toContain("ok");
    expect(table).toContain("fail");
    // Total: 14750ms total = 14.8s
    expect(table).toMatch(/Total: 14\.8s/);
    expect(table).toMatch(/2 steps/);
    expect(table).toMatch(/LLM 14\.0s/);
  });

  test("handles empty step list", () => {
    const table = renderSummary([]);
    expect(table).toContain("0 steps");
  });

  test("renders cache column when any step reported cache tokens", () => {
    const table = renderSummary([
      {
        step: 1,
        decisionMs: 1000,
        snapshotMs: 100,
        actionMs: 50,
        action: "navigate",
        ok: true,
        cacheReadTokens: 0,
        cacheCreationTokens: 4200,
      },
      {
        step: 2,
        decisionMs: 700,
        snapshotMs: 100,
        actionMs: 50,
        action: "click",
        ok: true,
        cacheReadTokens: 4200,
        cacheCreationTokens: 0,
      },
    ]);
    expect(table).toContain("cache");
    expect(table).toContain("0/4200");
    expect(table).toContain("4200/0");
    expect(table).toContain("4200 read");
    expect(table).toContain("4200 write");
  });

  test("omits cache column when no step reported cache tokens", () => {
    const table = renderSummary([
      {
        step: 1,
        decisionMs: 1000,
        snapshotMs: 100,
        actionMs: 50,
        action: "navigate",
        ok: true,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ]);
    expect(table).not.toContain("cache");
  });
});
