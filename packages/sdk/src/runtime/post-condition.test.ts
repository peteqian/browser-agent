import { describe, expect, test } from "bun:test";

import type { Page } from "../browser/session/session";
import { checkPostCondition } from "./post-condition";

function page(opts: { url?: string; counts?: Record<string, number>; body?: string }): Page {
  return {
    currentUrl: async () => opts.url ?? "",
    evaluate: async (script: string) => {
      if (script.includes("innerText")) return opts.body ?? "";
      const match = script.match(/querySelectorAll\((".*?")\)/);
      if (match) {
        const selector = JSON.parse(match[1]!);
        return opts.counts?.[selector] ?? 0;
      }
      return 0;
    },
  } as unknown as Page;
}

describe("checkPostCondition", () => {
  test("url_changed", async () => {
    expect(
      (
        await checkPostCondition(
          page({ url: "https://x/2" }),
          { type: "url_changed" },
          "https://x/1",
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await checkPostCondition(
          page({ url: "https://x/1" }),
          { type: "url_changed" },
          "https://x/1",
        )
      ).ok,
    ).toBe(false);
  });

  test("url_contains", async () => {
    const p = page({ url: "https://jobs.example.com/thanks" });
    expect((await checkPostCondition(p, { type: "url_contains", value: "thanks" })).ok).toBe(true);
    expect((await checkPostCondition(p, { type: "url_contains", value: "error" })).ok).toBe(false);
  });

  test("element_gone / element_present", async () => {
    const p = page({ counts: { ".spinner": 0, form: 1 } });
    expect((await checkPostCondition(p, { type: "element_gone", selector: ".spinner" })).ok).toBe(
      true,
    );
    expect((await checkPostCondition(p, { type: "element_gone", selector: "form" })).ok).toBe(
      false,
    );
    expect((await checkPostCondition(p, { type: "element_present", selector: "form" })).ok).toBe(
      true,
    );
  });

  test("text_present / text_absent", async () => {
    const p = page({ body: "Application submitted. Thank you!" });
    expect((await checkPostCondition(p, { type: "text_present", value: "submitted" })).ok).toBe(
      true,
    );
    expect((await checkPostCondition(p, { type: "text_absent", value: "error" })).ok).toBe(true);
    expect((await checkPostCondition(p, { type: "text_absent", value: "submitted" })).ok).toBe(
      false,
    );
  });
});
