import { describe, expect, test } from "bun:test";

import type { RunReport } from "./report";
import { redactReport, redactString, redactValue } from "./redact";

describe("redactString", () => {
  test("redacts emails and phones by default", () => {
    const out = redactString("Reach ada@example.com or +1 (555) 123-4567 today");
    expect(out).not.toContain("ada@example.com");
    expect(out).not.toContain("555");
    expect(out).toContain("[REDACTED]");
  });

  test("does not nuke short numbers like prices or counts", () => {
    const out = redactString("3 items, $42 total, 12 left");
    expect(out).toBe("3 items, $42 total, 12 left");
  });

  test("redacts known exact values, longest first", () => {
    const out = redactString("Ada Lovelace applied; Ada is great", {
      values: ["Ada Lovelace", "Ada"],
      emails: false,
      phones: false,
    });
    expect(out).toBe("[REDACTED] applied; [REDACTED] is great");
  });

  test("custom placeholder", () => {
    expect(redactString("a@b.com", { placeholder: "***" })).toBe("***");
  });
});

describe("redactValue", () => {
  test("deep-redacts nested objects and arrays", () => {
    const out = redactValue({
      user: { email: "x@y.com", notes: ["call +15551234567"] },
      count: 5,
    });
    expect(out.user.email).toBe("[REDACTED]");
    expect(out.user.notes[0]).toContain("[REDACTED]");
    expect(out.count).toBe(5);
  });
});

describe("redactReport", () => {
  test("scrubs task, summary, and action messages; keeps numbers", () => {
    const report: RunReport = {
      schemaVersion: 1,
      task: "Apply as ada@example.com",
      startedAt: "2026-06-12T00:00:00Z",
      finishedAt: "2026-06-12T00:00:01Z",
      durationMs: 1000,
      result: {
        success: true,
        reason: "completed",
        summary: "Sent to ada@example.com",
        data: null,
        steps: 1,
      },
      usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0 },
      costUsd: 0.01,
      costIsPartial: false,
      steps: [
        {
          step: 1,
          actions: [
            { name: "type", ok: true, durationMs: 5, message: "Typed ada@example.com into [3]" },
          ],
        },
      ],
      challenges: [],
      loopNudges: 0,
    };
    const out = redactReport(report);
    expect(out.task).not.toContain("ada@example.com");
    expect(out.result?.summary).not.toContain("ada@example.com");
    expect(out.steps[0]!.actions[0]!.message).not.toContain("ada@example.com");
    expect(out.usage.inputTokens).toBe(100);
    expect(out.costUsd).toBe(0.01);
  });
});
