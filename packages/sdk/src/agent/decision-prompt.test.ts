import { describe, expect, test } from "bun:test";

import type { AgentInput } from "./contracts";
import {
  buildDecisionPrompt,
  buildDecisionPromptParts,
  buildDecisionUserPrompt,
} from "./decision-prompt";
import { SYSTEM_PROMPT } from "./prompts";

function makeInput(overrides: Partial<AgentInput> = {}): AgentInput {
  return {
    task: "Find the price",
    step: 3,
    observation: "<html>example</html>",
    tabs: ["t1"],
    activeTab: "t1",
    history: [{ action: "navigate", result: "ok" }],
    actionCatalog: "- click: click an element\n- type: type text",
    memory: "user has logged in",
    ...overrides,
  };
}

describe("buildDecisionPromptParts", () => {
  test("prefix contains system prompt + action catalog", () => {
    const { prefix } = buildDecisionPromptParts(makeInput());
    expect(prefix).toContain(SYSTEM_PROMPT);
    expect(prefix).toContain("- click: click an element");
    expect(prefix).toContain("- type: type text");
  });

  test("suffix contains per-step task, step, observation, history, memory", () => {
    const { suffix } = buildDecisionPromptParts(makeInput());
    expect(suffix).toContain("Find the price");
    expect(suffix).toContain("Step: 3");
    expect(suffix).toContain("<html>example</html>");
    expect(suffix).toContain("user has logged in");
    expect(suffix).toContain("1. navigate => ok");
  });

  test("prefix does not include per-step content", () => {
    const { prefix } = buildDecisionPromptParts(makeInput());
    expect(prefix).not.toContain("Find the price");
    expect(prefix).not.toContain("<html>example</html>");
    expect(prefix).not.toContain("user has logged in");
  });

  test("prefix is identical across steps that share the same actionCatalog", () => {
    const a = buildDecisionPromptParts(makeInput({ step: 1, observation: "obs-a" }));
    const b = buildDecisionPromptParts(makeInput({ step: 5, observation: "obs-b" }));
    expect(a.prefix).toBe(b.prefix);
    expect(a.suffix).not.toBe(b.suffix);
  });

  test("prefix + suffix matches the legacy buildDecisionPrompt output", () => {
    const input = makeInput();
    const { prefix, suffix } = buildDecisionPromptParts(input);
    expect(`${prefix}\n\n${suffix}`).toBe(buildDecisionPrompt(input));
  });

  test("buildDecisionUserPrompt equals the suffix", () => {
    const input = makeInput();
    const { suffix } = buildDecisionPromptParts(input);
    expect(buildDecisionUserPrompt(input)).toBe(suffix);
  });
});
