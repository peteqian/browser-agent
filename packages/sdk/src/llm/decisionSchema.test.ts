import { describe, expect, test } from "bun:test";

import { MAX_ACTIONS_PER_DECISION, decisionJsonSchema, validateDecision } from "./decisionSchema";

describe("decisionJsonSchema", () => {
  test("declares actions and done as required fields", () => {
    expect(decisionJsonSchema.required).toContain("actions");
    expect(decisionJsonSchema.required).toContain("done");
  });

  test("actions item requires name and params", () => {
    expect(decisionJsonSchema.properties.actions.items.required).toEqual(["name", "params"]);
  });

  test("allows bounded action batches", () => {
    expect(decisionJsonSchema.properties.actions.maxItems).toBe(MAX_ACTIONS_PER_DECISION);
  });
});

describe("validateDecision", () => {
  test("accepts a minimal valid decision", () => {
    const result = validateDecision({
      actions: [{ name: "click", params: { index: 1 } }],
      done: false,
    });
    expect(result.actions).toEqual([{ name: "click", params: { index: 1 } }]);
    expect(result.done).toBe(false);
  });

  test("preserves thought, success, summary when present", () => {
    const result = validateDecision({
      thought: "trying again",
      actions: [{ name: "done", params: {} }],
      done: true,
      success: true,
      summary: "all good",
    });
    expect(result.thought).toBe("trying again");
    expect(result.success).toBe(true);
    expect(result.summary).toBe("all good");
  });

  test("preserves planning fields when present", () => {
    const result = validateDecision({
      memory: "Remembered page state",
      evaluationPreviousGoal: "Previous goal succeeded",
      nextGoal: "Click submit",
      plan: [{ id: "1", text: "Fill form", status: "in_progress" }],
      actions: [],
      done: false,
    });

    expect(result.memory).toBe("Remembered page state");
    expect(result.evaluationPreviousGoal).toBe("Previous goal succeeded");
    expect(result.nextGoal).toBe("Click submit");
    expect(result.plan).toEqual([{ id: "1", text: "Fill form", status: "in_progress" }]);
  });

  test("drops non-string thought silently", () => {
    const result = validateDecision({
      thought: 42,
      actions: [{ name: "click", params: {} }],
      done: false,
    });
    expect(result.thought).toBeUndefined();
  });

  test("defaults action.params to {} when omitted", () => {
    const result = validateDecision({
      actions: [{ name: "refresh" }],
      done: false,
    });
    expect(result.actions[0]?.params).toEqual({});
  });

  test("preserves a short action batch", () => {
    const result = validateDecision({
      actions: [
        { name: "focus", params: { index: 0 } },
        { name: "type", params: { index: 0, text: "hello" } },
        { name: "click", params: { index: 1 } },
      ],
      done: false,
    });

    expect(result.actions).toHaveLength(3);
    expect(result.actions[2]).toEqual({ name: "click", params: { index: 1 } });
  });

  test("caps oversized action batches", () => {
    const result = validateDecision({
      actions: [
        { name: "wait", params: { ms: 1 } },
        { name: "wait", params: { ms: 2 } },
        { name: "wait", params: { ms: 3 } },
        { name: "wait", params: { ms: 4 } },
        { name: "wait", params: { ms: 5 } },
      ],
      done: false,
    });

    expect(result.actions).toHaveLength(MAX_ACTIONS_PER_DECISION);
  });

  test("rejects null", () => {
    expect(() => validateDecision(null)).toThrow(/not an object/);
  });

  test("rejects non-array actions", () => {
    expect(() => validateDecision({ actions: "click", done: false })).toThrow(/must be an array/);
  });

  test("rejects action without name", () => {
    expect(() => validateDecision({ actions: [{ params: {} }], done: false })).toThrow(
      /missing name/,
    );
  });

  test("rejects action that is not an object", () => {
    expect(() => validateDecision({ actions: ["click"], done: false })).toThrow(/not an object/);
  });

  test("rejects non-boolean done", () => {
    expect(() => validateDecision({ actions: [], done: "yes" })).toThrow(/must be a boolean/);
  });
});
