import { describe, expect, test } from "bun:test";

import { buildFreeformDecisionPrompt, parseDecision } from "./parseDecision";
import type { AgentInput } from "./contracts";

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    task: "find pricing",
    step: 1,
    maxSteps: 40,
    activeTab: "https://example.com/",
    tabs: ["https://example.com/"],
    history: [],
    observation: "URL: https://example.com/\nTitle: Example",
    ...overrides,
  };
}

describe("parseDecision", () => {
  test("parses plain JSON", () => {
    const decision = parseDecision('{"name":"navigate","params":{"url":"https://example.com"}}');
    expect(decision.actions).toEqual([
      { name: "navigate", params: { url: "https://example.com" } },
    ]);
    expect(decision.done).toBe(false);
  });

  test("strips markdown json code fences", () => {
    const decision = parseDecision('```json\n{"name":"click","params":{"index":3}}\n```');
    expect(decision.actions[0]).toEqual({ name: "click", params: { index: 3 } });
  });

  test("strips bare code fences", () => {
    const decision = parseDecision('```\n{"name":"refresh","params":{}}\n```');
    expect(decision.actions[0]?.name).toBe("refresh");
  });

  test("extracts first balanced JSON object from surrounding prose", () => {
    const raw = 'I think we should: {"name":"scroll","params":{"direction":"down"}} OK?';
    const decision = parseDecision(raw);
    expect(decision.actions[0]).toEqual({ name: "scroll", params: { direction: "down" } });
  });

  test("handles nested braces inside params", () => {
    const decision = parseDecision('{"name":"type","params":{"text":"{nested}","index":1}}');
    expect(decision.actions[0]).toEqual({
      name: "type",
      params: { text: "{nested}", index: 1 },
    });
  });

  test("handles escaped quotes in strings", () => {
    const raw = '{"name":"type","params":{"text":"hello \\"world\\""}}';
    const decision = parseDecision(raw);
    expect(decision.actions[0]).toEqual({
      name: "type",
      params: { text: 'hello "world"' },
    });
  });

  test("done action sets done/summary/success from params", () => {
    const decision = parseDecision('{"name":"done","params":{"success":true,"summary":"ok"}}');
    expect(decision.done).toBe(true);
    expect(decision.success).toBe(true);
    expect(decision.summary).toBe("ok");
  });

  test("done with missing summary defaults to empty string", () => {
    const decision = parseDecision('{"name":"done","params":{"success":false}}');
    expect(decision.done).toBe(true);
    expect(decision.success).toBe(false);
    expect(decision.summary).toBe("");
  });

  test("parses optional thought/nextGoal/memory", () => {
    const decision = parseDecision(
      '{"thought":"page loaded","nextGoal":"extract H1","memory":"n=1","name":"click","params":{"index":2}}',
    );
    expect(decision.thought).toBe("page loaded");
    expect(decision.nextGoal).toBe("extract H1");
    expect(decision.memory).toBe("n=1");
  });

  test("non-done action leaves summary undefined", () => {
    const decision = parseDecision('{"name":"click","params":{"index":1}}');
    expect(decision.summary).toBeUndefined();
    expect(decision.success).toBeUndefined();
  });

  test("missing name throws", () => {
    expect(() => parseDecision('{"params":{}}')).toThrow(/missing action name/);
  });

  test("non-string name throws", () => {
    expect(() => parseDecision('{"name":42,"params":{}}')).toThrow(/missing action name/);
  });

  test("absent params defaults to empty object", () => {
    const decision = parseDecision('{"name":"go_back"}');
    expect(decision.actions[0]).toEqual({ name: "go_back", params: {} });
  });

  test("garbage input throws", () => {
    expect(() => parseDecision("not json at all")).toThrow();
  });
});

describe("buildFreeformDecisionPrompt", () => {
  test("includes task, step, tabs, observation", () => {
    const prompt = buildFreeformDecisionPrompt(makeInput());
    expect(prompt).toContain("Task: find pricing");
    expect(prompt).toContain("Step: 1");
    expect(prompt).toContain("Active tab: https://example.com/");
    expect(prompt).toContain("Open tabs: https://example.com/");
    expect(prompt).toContain("URL: https://example.com/");
  });

  test("renders empty history as '(none)'", () => {
    const prompt = buildFreeformDecisionPrompt(makeInput({ history: [] }));
    expect(prompt).toContain("Recent action history:\n(none)");
  });

  test("numbers history entries from 1", () => {
    const prompt = buildFreeformDecisionPrompt(
      makeInput({
        history: [
          { action: "navigate(url=...)", result: "ok" },
          { action: "click(index=3)", result: "ok" },
        ],
      }),
    );
    expect(prompt).toContain("1. navigate(url=...) => ok");
    expect(prompt).toContain("2. click(index=3) => ok");
  });

  test("includes JSON shape directive for freeform adapters", () => {
    const prompt = buildFreeformDecisionPrompt(makeInput());
    expect(prompt).toContain('{"name":"<action_name>","params":{...}}');
    expect(prompt).toContain("Do not return any text outside JSON");
  });

  test("documents done.params.summary requirement", () => {
    const prompt = buildFreeformDecisionPrompt(makeInput());
    expect(prompt).toContain("params.summary");
    expect(prompt).toContain('"name":"done"');
  });

  test("does NOT prepend system prompt — caller responsibility", () => {
    const prompt = buildFreeformDecisionPrompt(makeInput());
    expect(prompt.startsWith("Task:")).toBe(true);
  });
});
