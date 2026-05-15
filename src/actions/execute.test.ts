import { describe, expect, test } from "bun:test";

import type { NavigationHealthResult, Page } from "../browser/session";
import type { SelectorMap } from "../dom/cdp-snapshot";
import { executeAction } from "./execute";

function singleEntrySelectorMap(index: number, backendNodeId: number): SelectorMap {
  return { byIndex: new Map([[index, { backendNodeId }]]) };
}

interface TypeCall {
  backendNodeId: number;
  text: string;
  submit: boolean;
  mode: "replace" | "append";
}

function createTypePage(
  result:
    | { ok: true }
    | { ok: false; reason: "index_stale" }
    | { ok: false; reason: "not_typable" }
    | { ok: false; reason: "value_mismatch" },
): { page: Page; calls: TypeCall[] } {
  const calls: TypeCall[] = [];
  const page = {
    typeByBackendNodeId: async (
      backendNodeId: number,
      text: string,
      submit: boolean,
      mode: "replace" | "append",
    ) => {
      calls.push({ backendNodeId, text, submit, mode });
      return result;
    },
  } as unknown as Page;
  return { page, calls };
}

function createPageWithNavigation(health: NavigationHealthResult): Page {
  return {
    targetId: "page-1",
    navigateWithHealthCheck: async () => health,
  } as unknown as Page;
}

describe("executeAction navigation watchdog metadata", () => {
  test("includes navigation health data on successful navigate", async () => {
    const health: NavigationHealthResult = {
      ok: true,
      status: "loaded",
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      readyState: "complete",
      durationMs: 12,
    };

    const result = await executeAction(createPageWithNavigation(health), {
      name: "navigate",
      params: { url: "https://example.com/" },
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ navigation: health });
  });

  test("includes navigation health data on failed navigate", async () => {
    const health: NavigationHealthResult = {
      ok: false,
      status: "empty",
      url: "https://example.com/empty",
      finalUrl: "https://example.com/empty",
      readyState: "complete",
      durationMs: 25,
      warning: "Page loaded but returned empty content.",
    };

    const result = await executeAction(createPageWithNavigation(health), {
      name: "navigate",
      params: { url: "https://example.com/empty" },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("page appears empty");
    expect(result.data).toEqual({ navigation: health });
  });

  test("uses navigation health metadata for new_tab URLs", async () => {
    const health: NavigationHealthResult = {
      ok: true,
      status: "loaded",
      url: "https://example.com/",
      finalUrl: "https://example.com/",
      readyState: "complete",
      durationMs: 12,
    };
    const tab = createPageWithNavigation(health);
    const session = {
      newPage: async () => tab,
    };

    const result = await executeAction(
      createPageWithNavigation(health),
      { name: "new_tab", params: { url: "https://example.com/" } },
      session as never,
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ navigation: health });
    expect(result.activeTargetId).toBe("page-1");
  });
});

describe("executeAction type secrets and verification", () => {
  test("substitutes <secret> placeholder with sensitiveData value", async () => {
    const { page, calls } = createTypePage({ ok: true });
    const result = await executeAction(
      page,
      { name: "type", params: { index: 0, text: "<secret>password</secret>", mode: "replace" } },
      undefined,
      undefined,
      singleEntrySelectorMap(0, 42),
      { password: "hunter2" },
    );

    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.text).toBe("hunter2");
    expect(calls[0]?.mode).toBe("replace");
    expect(result.message).not.toContain("hunter2");
    expect(result.longTermMemory ?? "").not.toContain("hunter2");
  });

  test("fails when secret placeholder key is missing", async () => {
    const { page, calls } = createTypePage({ ok: true });
    const result = await executeAction(
      page,
      { name: "type", params: { index: 0, text: "<secret>missing</secret>", mode: "replace" } },
      undefined,
      undefined,
      singleEntrySelectorMap(0, 42),
      {},
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("<secret>missing</secret>");
    expect(calls).toHaveLength(0);
  });

  test("text without placeholders passes through unchanged when sensitiveData provided", async () => {
    const { page, calls } = createTypePage({ ok: true });
    await executeAction(
      page,
      { name: "type", params: { index: 0, text: "plain text", mode: "replace" } },
      undefined,
      undefined,
      singleEntrySelectorMap(0, 42),
      { password: "hunter2" },
    );

    expect(calls[0]?.text).toBe("plain text");
  });

  test("substitutes multiple distinct placeholders in one text", async () => {
    const { page, calls } = createTypePage({ ok: true });
    await executeAction(
      page,
      {
        name: "type",
        params: {
          index: 0,
          text: "<secret>user</secret>:<secret>pass</secret>",
          mode: "replace",
        },
      },
      undefined,
      undefined,
      singleEntrySelectorMap(0, 42),
      { user: "alice", pass: "hunter2" },
    );

    expect(calls[0]?.text).toBe("alice:hunter2");
  });

  test("forwards append mode to page method", async () => {
    const { page, calls } = createTypePage({ ok: true });
    await executeAction(
      page,
      { name: "type", params: { index: 0, text: "x", mode: "append" } },
      undefined,
      undefined,
      singleEntrySelectorMap(0, 42),
    );

    expect(calls[0]?.mode).toBe("append");
  });

  test("value_mismatch surfaces as terse failure without echoing the typed value", async () => {
    const { page } = createTypePage({ ok: false, reason: "value_mismatch" });
    const result = await executeAction(
      page,
      { name: "type", params: { index: 7, text: "<secret>password</secret>", mode: "replace" } },
      undefined,
      undefined,
      singleEntrySelectorMap(7, 42),
      { password: "hunter2" },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("verification");
    expect(result.message).not.toContain("hunter2");
    expect(result.message).not.toContain("expected");
    expect(result.extractedContent ?? "").not.toContain("hunter2");
  });
});
