import { describe, expect, test } from "bun:test";
import { z } from "zod/v4";

import { createActionRegistry, createDefaultActionRegistry } from "./registry";
import type { Page } from "../browser/session";
import type { BrowserStateSummary } from "../browser/state";

function fakeState(url: string): BrowserStateSummary {
  return {
    url,
    title: "",
    activeTab: "t",
    tabs: [],
    viewport: { width: 1, height: 1 },
    readyState: "complete",
    pendingRequests: [],
    elements: [],
    selectorMap: { byIndex: new Map() },
    observation: "",
  } as BrowserStateSummary;
}

describe("ActionRegistry", () => {
  test("parses and executes custom actions", async () => {
    const registry = createActionRegistry([
      {
        name: "say",
        description: "Return the provided text.",
        schema: z.object({ text: z.string() }),
        run: async (params) => ({
          ok: true,
          message: (params as { text: string }).text,
          extractedContent: (params as { text: string }).text,
        }),
      },
    ]);

    const action = registry.parse("say", { text: "hello" });
    expect(action).toEqual({ name: "say", params: { text: "hello" } });

    const result = await registry.execute(action!, { page: {} as Page });
    expect(result.ok).toBe(true);
    expect(result.message).toBe("hello");
  });

  test("rejects invalid action payloads", () => {
    const registry = createActionRegistry([
      {
        name: "say",
        description: "Return the provided text.",
        schema: z.object({ text: z.string() }),
        run: async () => ({ ok: true, message: "" }),
      },
    ]);

    expect(registry.parse("say", { text: 123 })).toBeNull();
    expect(registry.parse("missing", {})).toBeNull();
  });

  test("default registry exposes built-in actions for prompts", () => {
    const catalog = createDefaultActionRegistry().describeForPrompt();
    expect(catalog).toContain("navigate");
    expect(catalog).toContain("done");
  });

  test("filters actions whose appliesTo predicate rejects the current state", () => {
    const registry = createActionRegistry([
      {
        name: "always",
        description: "Always available.",
        schema: z.object({}),
        run: async () => ({ ok: true, message: "" }),
      },
      {
        name: "only_example",
        description: "Only on example.com.",
        schema: z.object({}),
        run: async () => ({ ok: true, message: "" }),
        appliesTo: (state) => state.url.includes("example.com"),
      },
    ]);

    const onExample = registry.describeForPrompt(fakeState("https://example.com/jobs"));
    expect(onExample).toContain("only_example");
    expect(onExample).toContain("always");

    const elsewhere = registry.describeForPrompt(fakeState("https://other.com/"));
    expect(elsewhere).toContain("always");
    expect(elsewhere).not.toContain("only_example");

    expect(registry.listFor(fakeState("https://other.com/")).map((d) => d.name)).toEqual([
      "always",
    ]);
  });

  test("catalog and tool defs keep stable identity while the visible set is unchanged", () => {
    const registry = createActionRegistry([
      {
        name: "always",
        description: "Always available.",
        schema: z.object({}),
        run: async () => ({ ok: true, message: "" }),
      },
      {
        name: "only_example",
        description: "Only on example.com.",
        schema: z.object({}),
        run: async () => ({ ok: true, message: "" }),
        appliesTo: (state) => state.url.includes("example.com"),
      },
    ]);

    // Different state objects, same visible set → same string/array instance,
    // so provider prompt caches see a byte-identical prefix every step.
    const a = registry.describeForPrompt(fakeState("https://other.com/1"));
    const b = registry.describeForPrompt(fakeState("https://other.com/2"));
    expect(b).toBe(a);
    const toolsA = registry.toolDefsFor(fakeState("https://other.com/1"));
    const toolsB = registry.toolDefsFor(fakeState("https://other.com/2"));
    expect(toolsB).toBe(toolsA);

    // Visible set changes → fresh catalog.
    const c = registry.describeForPrompt(fakeState("https://example.com/"));
    expect(c).not.toBe(a);
    expect(c).toContain("only_example");
    // And flipping back recomputes correctly.
    expect(registry.describeForPrompt(fakeState("https://other.com/3"))).toBe(
      registry.describeForPrompt(fakeState("https://other.com/4")),
    );
  });

  test("type action defaults mode to replace when omitted", () => {
    const registry = createDefaultActionRegistry();
    const parsed = registry.parse("type", { index: 0, text: "x" });
    expect(parsed).not.toBeNull();
    expect((parsed!.params as { mode: string }).mode).toBe("replace");
  });
});
