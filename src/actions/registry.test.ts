import { describe, expect, test } from "bun:test";
import { z } from "zod";

import { createActionRegistry, createDefaultActionRegistry } from "./registry";
import type { Page } from "../browser/session";

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

  test("type action defaults mode to replace when omitted", () => {
    const registry = createDefaultActionRegistry();
    const parsed = registry.parse("type", { index: 0, text: "x" });
    expect(parsed).not.toBeNull();
    expect((parsed!.params as { mode: string }).mode).toBe("replace");
  });
});
