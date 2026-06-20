import { describe, expect, test } from "bun:test";

import type { Page } from "../../browser/session/session";
import { canReuseSnapshot, capturePageFingerprint } from "./snapshot-reuse";

describe("canReuseSnapshot", () => {
  test("empty step (no actions) is reusable", () => {
    expect(canReuseSnapshot([])).toBe(true);
  });

  test("read-only built-ins are reusable regardless of outcome", () => {
    expect(
      canReuseSnapshot([
        { name: "find_elements", ok: true },
        { name: "find_by_role", ok: true },
        { name: "search_page", ok: false },
        { name: "screenshot", ok: true },
        { name: "cookies_get", ok: true },
      ]),
    ).toBe(true);
  });

  test("successful custom (non-built-in) actions are reusable candidates", () => {
    expect(canReuseSnapshot([{ name: "lookup_candidate_profile", ok: true }])).toBe(true);
  });

  test("failed mutating actions without partial effects are reusable", () => {
    // A click/navigate that failed never touched the page.
    expect(
      canReuseSnapshot([
        { name: "click", ok: false },
        { name: "navigate", ok: false },
        { name: "scroll", ok: false },
      ]),
    ).toBe(true);
  });

  test("successful navigation/click/type/scroll force re-capture", () => {
    for (const name of ["navigate", "click", "click_by", "type", "fill", "scroll", "go_back"]) {
      expect(canReuseSnapshot([{ name, ok: true }])).toBe(false);
    }
  });

  test("failed input-dispatching actions force re-capture (partial effects)", () => {
    // `type` can fail value verification after keystrokes were dispatched.
    for (const name of ["type", "fill", "type_by", "keyboard_type", "send_keys", "eval"]) {
      expect(canReuseSnapshot([{ name, ok: false }])).toBe(false);
    }
  });

  test("wait and focus_area force re-capture even on success", () => {
    // wait exists to pick up new content; focus_area changes observation rendering.
    expect(canReuseSnapshot([{ name: "wait", ok: true }])).toBe(false);
    expect(canReuseSnapshot([{ name: "focus_area", ok: true }])).toBe(false);
  });

  test("one disqualifying action poisons the whole step", () => {
    expect(
      canReuseSnapshot([
        { name: "find_elements", ok: true },
        { name: "click", ok: true },
      ]),
    ).toBe(false);
  });
});

describe("capturePageFingerprint", () => {
  test("returns a stable string for an unchanged page", async () => {
    const page = {
      evaluate: async () => JSON.stringify({ url: "https://example.com/", nodes: 42, html: 1234 }),
    } as unknown as Page;
    const a = await capturePageFingerprint(page);
    const b = await capturePageFingerprint(page);
    expect(a).not.toBeNull();
    expect(a).toBe(b as string);
  });

  test("returns null when evaluation fails so callers re-capture", async () => {
    const page = {
      evaluate: async () => {
        throw new Error("Execution context was destroyed");
      },
    } as unknown as Page;
    expect(await capturePageFingerprint(page)).toBeNull();
  });

  test("differs when the page changed", async () => {
    let nodes = 10;
    const page = {
      evaluate: async () => JSON.stringify({ url: "https://example.com/", nodes: nodes++ }),
    } as unknown as Page;
    const a = await capturePageFingerprint(page);
    const b = await capturePageFingerprint(page);
    expect(a).not.toBe(b);
  });
});
