import { describe, expect, test } from "bun:test";

import type { AgentEvent } from "../decide/contracts";
import { RunReportCollector, toJUnitXml } from "./report";

function feed(collector: RunReportCollector, events: AgentEvent<unknown>[]): void {
  for (const event of events) collector.handleEvent(event);
}

function successfulRunEvents(): AgentEvent<unknown>[] {
  return [
    {
      type: "transport_resolved",
      resolution: {
        provider: "claude",
        env: "local",
        transport: "sdk-api",
        durationMs: 5,
      },
    },
    { type: "snapshot_started", stepIndex: 1 },
    { type: "snapshot_captured", stepIndex: 1, durationMs: 120, elementCount: 40, bytes: 9000 },
    { type: "decision_started", stepIndex: 1, provider: "claude", model: "" },
    {
      type: "decision_completed",
      stepIndex: 1,
      durationMs: 900,
      tokensIn: 10_000,
      tokensOut: 500,
      cacheReadTokens: 2_000,
    },
    {
      type: "decision",
      step: 1,
      decision: {
        actions: [{ name: "click", params: { index: 3 } }],
        done: false,
        telemetry: {
          model: "claude-sonnet-4-6",
          usage: { inputTokens: 10_000, outputTokens: 500, cachedInputTokens: 2_000 },
        },
      },
    },
    { type: "action_started", stepIndex: 1, action: "click" },
    { type: "action_completed", stepIndex: 1, action: "click", durationMs: 45, ok: true },
    {
      type: "action",
      step: 1,
      url: "https://example.com",
      action: { name: "click", params: { index: 3 } },
      result: { ok: true, message: "Clicked element [3]" },
    },
    {
      type: "challenge",
      step: 2,
      encounter: {
        vendor: "cloudflare-interstitial",
        url: "https://example.com/jobs",
        resolved: true,
        action: "waited",
        durationMs: 3000,
        detectedAt: new Date().toISOString(),
      },
    },
    {
      type: "terminal",
      result: {
        success: true,
        reason: "completed",
        summary: "Applied to job",
        data: null,
        steps: 2,
      },
    },
  ];
}

describe("RunReportCollector", () => {
  test("aggregates usage, cost, steps, challenges, and terminal result", () => {
    const collector = new RunReportCollector({ task: "apply to job" });
    feed(collector, successfulRunEvents());
    const report = collector.build();

    expect(report.task).toBe("apply to job");
    expect(report.result?.success).toBe(true);
    expect(report.provider).toBe("claude");
    expect(report.transport).toBe("sdk-api");
    expect(report.model).toBe("claude-sonnet-4-6");
    expect(report.usage).toEqual({
      inputTokens: 10_000,
      outputTokens: 500,
      cacheReadTokens: 2_000,
      cacheCreationTokens: 0,
    });
    // sonnet: 10k in * $3/M + 500 out * $15/M + 2k cacheRead * $0.3/M
    expect(report.costUsd).toBeCloseTo(0.03 + 0.0075 + 0.0006, 6);
    expect(report.costIsPartial).toBe(false);
    expect(report.steps).toHaveLength(1);
    expect(report.steps[0]).toMatchObject({
      step: 1,
      snapshot: { durationMs: 120, elementCount: 40, bytes: 9000 },
      decision: { inputTokens: 10_000, model: "claude-sonnet-4-6" },
    });
    expect(report.steps[0]!.actions).toEqual([
      { name: "click", ok: true, durationMs: 45, message: "Clicked element [3]" },
    ]);
    expect(report.challenges).toHaveLength(1);
  });

  test("unknown model marks cost partial instead of guessing", () => {
    const collector = new RunReportCollector();
    feed(collector, [
      {
        type: "decision_completed",
        stepIndex: 1,
        durationMs: 100,
        tokensIn: 100,
        tokensOut: 10,
      },
      {
        type: "decision",
        step: 1,
        decision: {
          actions: [],
          done: true,
          telemetry: { model: "mystery-model" },
        },
      },
    ]);
    const report = collector.build();
    expect(report.costUsd).toBeNull();
    expect(report.costIsPartial).toBe(true);
  });
});

describe("toJUnitXml", () => {
  test("success renders zero failures with properties", () => {
    const collector = new RunReportCollector({ task: "apply to job" });
    feed(collector, successfulRunEvents());
    const xml = toJUnitXml(collector.build());
    expect(xml).toContain('failures="0"');
    expect(xml).toContain('<testcase name="apply to job"');
    expect(xml).toContain('<property name="challenges" value="1"/>');
    expect(xml).not.toContain("<failure");
  });

  test("failure renders failure node with reason and summary", () => {
    const collector = new RunReportCollector({ task: "broken <task>" });
    feed(collector, [
      {
        type: "terminal",
        result: {
          success: false,
          reason: "max_failures",
          summary: 'Too many "errors" & retries',
          data: null,
          steps: 5,
        },
      },
    ]);
    const xml = toJUnitXml(collector.build());
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('<failure message="max_failures">');
    expect(xml).toContain("&quot;errors&quot; &amp; retries");
    expect(xml).toContain("broken &lt;task&gt;");
  });
});
