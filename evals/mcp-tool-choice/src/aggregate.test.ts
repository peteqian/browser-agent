import { describe, expect, test } from "bun:test";

import { aggregate } from "./aggregate";
import { scorePlan } from "./runner";
import type { BenchTask, RunBundle, TaskRunRecord } from "./types";

function record(
  task: BenchTask,
  called: string[],
  overrides: Partial<TaskRunRecord> = {},
): TaskRunRecord {
  const result = scorePlan(task, called);
  return {
    task_id: task.task_id,
    category: task.category,
    agent: "test",
    agent_version: "0.0.0",
    model: "test",
    judge_model: "test",
    started_at: "2026-01-01T00:00:00Z",
    ended_at: "2026-01-01T00:00:01Z",
    duration_ms: 1000,
    expected_tools: task.expected_tools,
    forbidden_tools: task.forbidden_tools ?? [],
    toolChoiceResult: result,
    rawPlan: "",
    ...overrides,
  };
}

describe("scorePlan", () => {
  const navTask: BenchTask = {
    task_id: "t",
    category: "navigation",
    confirmed_task: "open it",
    expected_tools: ["launch_session", "navigate"],
    forbidden_tools: ["save_as_pdf"],
  };

  test("perfect plan: precision=recall=f1=1, verdict=true", () => {
    const r = scorePlan(navTask, ["launch_session", "navigate"]);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f1).toBe(1);
    expect(r.verdict).toBe(true);
    expect(r.forbidden_hits).toEqual([]);
  });

  test("missing tool reduces recall and fails verdict", () => {
    const r = scorePlan(navTask, ["navigate"]);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(0.5);
    expect(r.f1).toBeCloseTo(0.6667, 3);
    expect(r.verdict).toBe(false);
  });

  test("extra tool reduces precision but recall stays 1", () => {
    const r = scorePlan(navTask, ["launch_session", "navigate", "screenshot"]);
    expect(r.precision).toBeCloseTo(2 / 3, 3);
    expect(r.recall).toBe(1);
    expect(r.f1).toBeCloseTo(0.8, 3);
    // verdict still true: recall=1 and no forbidden hit
    expect(r.verdict).toBe(true);
  });

  test("forbidden tool fails verdict even if recall is perfect", () => {
    const r = scorePlan(navTask, ["launch_session", "navigate", "save_as_pdf"]);
    expect(r.recall).toBe(1);
    expect(r.forbidden_hits).toEqual(["save_as_pdf"]);
    expect(r.verdict).toBe(false);
  });

  test("unknown tool fails verdict", () => {
    const r = scorePlan(navTask, ["launch_session", "navigate", "teleport"]);
    expect(r.verdict).toBe(false);
    expect(r.reasoning).toContain("unknown_tools=teleport");
  });

  test("empty plan: zero precision, zero recall", () => {
    const r = scorePlan(navTask, []);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
    expect(r.f1).toBe(0);
    expect(r.verdict).toBe(false);
  });
});

describe("aggregate", () => {
  const taskA: BenchTask = {
    task_id: "a",
    category: "navigation",
    confirmed_task: "x",
    expected_tools: ["navigate"],
  };
  const taskB: BenchTask = {
    task_id: "b",
    category: "extraction",
    confirmed_task: "y",
    expected_tools: ["find_elements"],
    forbidden_tools: ["save_as_pdf"],
  };

  test("aggregates pass_rate, precision, recall, f1, forbidden", () => {
    const bundle: RunBundle = {
      commit_sha: "x",
      run_started_at: "2026-01-01T00:00:00Z",
      agent: "a",
      agent_version: "0.0.0",
      model: "m",
      judge_model: "j",
      records: [
        record(taskA, ["navigate"]), // pass, p=r=f=1
        record(taskB, ["find_elements", "save_as_pdf"]), // forbidden, verdict=false
      ],
    };
    const row = aggregate(bundle);
    expect(row.attempted).toBe(2);
    expect(row.passed).toBe(1);
    expect(row.pass_rate).toBe(0.5);
    expect(row.precision).toBeCloseTo((1 + 0.5) / 2, 3);
    expect(row.recall).toBe(1);
    expect(row.forbidden_violations).toBe(1);
    expect(row.by_category.navigation?.passed).toBe(1);
    expect(row.by_category.extraction?.passed).toBe(0);
  });
});
