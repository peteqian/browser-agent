import { describe, expect, test } from "bun:test";

import type { BrowserSession, NavigationHealthResult, Page } from "../browser/session";
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

describe("executeAction allowedDomains policy", () => {
  test("blocks navigate URL outside the allowlist without touching the page", async () => {
    let navigated = false;
    const page = {
      targetId: "page-1",
      navigateWithHealthCheck: async () => {
        navigated = true;
        return {
          ok: true,
          status: "loaded",
          url: "https://evil.com/",
          finalUrl: "https://evil.com/",
          readyState: "complete",
          durationMs: 1,
        } as NavigationHealthResult;
      },
    } as unknown as Page;

    const result = await executeAction(
      page,
      { name: "navigate", params: { url: "https://evil.com/path" } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { allowedDomains: ["example.com"] },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("blocked by allowedDomains");
    expect(navigated).toBe(false);
    expect(result.data).toEqual({
      blocked: { url: "https://evil.com/path", reason: "allowedDomains" },
    });
  });

  test("allows navigate URL whose host matches a wildcard pattern", async () => {
    const health: NavigationHealthResult = {
      ok: true,
      status: "loaded",
      url: "https://api.example.com/",
      finalUrl: "https://api.example.com/",
      readyState: "complete",
      durationMs: 5,
    };

    const result = await executeAction(
      createPageWithNavigation(health),
      { name: "navigate", params: { url: "https://api.example.com/" } },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { allowedDomains: ["*.example.com"] },
    );

    expect(result.ok).toBe(true);
  });

  test("blocks new_tab URL outside the allowlist without opening a tab", async () => {
    let opened = false;
    const session = {
      newPage: async () => {
        opened = true;
        return createPageWithNavigation({
          ok: true,
          status: "loaded",
          url: "https://evil.com/",
          finalUrl: "https://evil.com/",
          readyState: "complete",
          durationMs: 1,
        });
      },
    } as unknown as BrowserSession;

    const result = await executeAction(
      createPageWithNavigation({
        ok: true,
        status: "loaded",
        url: "about:blank",
        finalUrl: "about:blank",
        readyState: "complete",
        durationMs: 0,
      }),
      { name: "new_tab", params: { url: "https://evil.com/" } },
      session,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { allowedDomains: ["example.com"] },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("blocked by allowedDomains");
    expect(opened).toBe(false);
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

function createClickPage(): { page: Page } {
  const page = {
    targetId: "page-1",
    clickByBackendNodeId: async () => ({ ok: true }) as const,
  } as unknown as Page;
  return { page };
}

function createSessionWithTabSpawn(newTargetId: string | null): BrowserSession {
  return {
    waitForNewPageTarget: async (_timeoutMs: number, _openerTargetId?: string) => newTargetId,
  } as unknown as BrowserSession;
}

describe("executeAction click new-tab detection", () => {
  test("switches active page when click spawns a new tab", async () => {
    const { page } = createClickPage();
    const session = createSessionWithTabSpawn("page-2");
    const result = await executeAction(
      page,
      { name: "click", params: { index: 3 } },
      session,
      undefined,
      singleEntrySelectorMap(3, 99),
      undefined,
      500,
    );

    expect(result.ok).toBe(true);
    expect(result.activeTargetId).toBe("page-2");
    expect(result.message).toContain("page-2");
    expect(result.longTermMemory).toContain("page-2");
  });

  test("does not set activeTargetId when click does not spawn a tab", async () => {
    const { page } = createClickPage();
    const session = createSessionWithTabSpawn(null);
    const result = await executeAction(
      page,
      { name: "click", params: { index: 3 } },
      session,
      undefined,
      singleEntrySelectorMap(3, 99),
      undefined,
      500,
    );

    expect(result.ok).toBe(true);
    expect(result.activeTargetId).toBeUndefined();
    expect(result.message).not.toContain("switched");
  });

  test("ignores spawned tab when it matches current page targetId", async () => {
    const { page } = createClickPage();
    const session = createSessionWithTabSpawn("page-1");
    const result = await executeAction(
      page,
      { name: "click", params: { index: 3 } },
      session,
      undefined,
      singleEntrySelectorMap(3, 99),
      undefined,
      500,
    );

    expect(result.activeTargetId).toBeUndefined();
  });

  test("passes current page targetId as openerId filter", async () => {
    const { page } = createClickPage();
    const captured: { openerId?: string } = {};
    const session = {
      waitForNewPageTarget: async (_timeoutMs: number, openerTargetId?: string) => {
        captured.openerId = openerTargetId;
        return null;
      },
    } as unknown as BrowserSession;
    await executeAction(
      page,
      { name: "click", params: { index: 3 } },
      session,
      undefined,
      singleEntrySelectorMap(3, 99),
      undefined,
      500,
    );

    expect(captured.openerId).toBe("page-1");
  });

  test("detects new tab when clicking by coordinates", async () => {
    const page = {
      targetId: "page-1",
      clickAtCoordinates: async () => {},
    } as unknown as Page;
    const session = createSessionWithTabSpawn("page-2");
    const result = await executeAction(
      page,
      { name: "click", params: { coordinateX: 100, coordinateY: 200 } },
      session,
      undefined,
      undefined,
      undefined,
      500,
    );

    expect(result.ok).toBe(true);
    expect(result.activeTargetId).toBe("page-2");
  });

  test("skips detection when newTabDetectMs is 0", async () => {
    const { page } = createClickPage();
    let watched = false;
    const session = {
      waitForNewPageTarget: async () => {
        watched = true;
        return "page-2";
      },
    } as unknown as BrowserSession;
    const result = await executeAction(
      page,
      { name: "click", params: { index: 3 } },
      session,
      undefined,
      singleEntrySelectorMap(3, 99),
      undefined,
      0,
    );

    expect(result.ok).toBe(true);
    expect(result.activeTargetId).toBeUndefined();
    expect(watched).toBe(false);
  });
});

describe("executeAction upload_file validation and nearest-input discovery", () => {
  test("fails before any CDP call when path does not exist", async () => {
    let pageCalls = 0;
    const page = {
      findNearestFileInputBackendNodeId: async () => {
        pageCalls += 1;
        return { ok: true, backendNodeId: 1 } as const;
      },
      uploadFilesByBackendNodeId: async () => {
        pageCalls += 1;
        return { ok: true } as const;
      },
    } as unknown as Page;

    const result = await executeAction(
      page,
      {
        name: "upload_file",
        params: { index: 0, paths: ["/tmp/definitely-does-not-exist-bagent.bin"] },
      },
      undefined,
      undefined,
      singleEntrySelectorMap(0, 42),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("file not found");
    expect(pageCalls).toBe(0);
  });

  test("uploads using the discovered nearest file input backend id", async () => {
    const calls: { upload?: { backendNodeId: number; paths: string[] } } = {};
    const page = {
      findNearestFileInputBackendNodeId: async (_backendNodeId: number) =>
        ({ ok: true, backendNodeId: 999 }) as const,
      uploadFilesByBackendNodeId: async (backendNodeId: number, paths: string[]) => {
        calls.upload = { backendNodeId, paths };
        return { ok: true } as const;
      },
    } as unknown as Page;

    const result = await executeAction(
      page,
      { name: "upload_file", params: { index: 0, paths: [import.meta.path] } },
      undefined,
      undefined,
      singleEntrySelectorMap(0, 42),
    );

    expect(result.ok).toBe(true);
    expect(calls.upload?.backendNodeId).toBe(999);
    expect(calls.upload?.paths).toEqual([import.meta.path]);
  });

  test("fails terse when no nearby file input exists", async () => {
    const page = {
      findNearestFileInputBackendNodeId: async () =>
        ({ ok: false, reason: "no_file_input" }) as const,
      uploadFilesByBackendNodeId: async () => ({ ok: true }) as const,
    } as unknown as Page;

    const result = await executeAction(
      page,
      { name: "upload_file", params: { index: 5, paths: [import.meta.path] } },
      undefined,
      undefined,
      singleEntrySelectorMap(5, 42),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("Could not find a file input");
    expect(result.message).toContain("[5]");
  });

  test("surfaces stale element when discovery says index_stale", async () => {
    const page = {
      findNearestFileInputBackendNodeId: async () =>
        ({ ok: false, reason: "index_stale" }) as const,
      uploadFilesByBackendNodeId: async () => ({ ok: true }) as const,
    } as unknown as Page;

    const result = await executeAction(
      page,
      { name: "upload_file", params: { index: 7, paths: [import.meta.path] } },
      undefined,
      undefined,
      singleEntrySelectorMap(7, 42),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain("no longer exists");
  });
});

describe("executeAction extract_content error mapping", () => {
  test("classifies navigation-in-flight errors and surfaces structured data", async () => {
    const page = {
      extractContent: async () => {
        throw new Error("Execution context was destroyed");
      },
    } as unknown as Page;
    const result = await executeAction(page, {
      name: "extract_content",
      params: { query: "anything" },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("navigation_in_flight");
    expect(result.data).toEqual({
      extractionError: {
        reason: "navigation_in_flight",
        message: "Execution context was destroyed",
      },
    });
  });

  test("forwards alreadyCollected to extractContent for pagination dedupe", async () => {
    const captured: { params?: { alreadyCollected?: string[] } } = {};
    const page = {
      extractContent: async (params: { alreadyCollected?: string[] }) => {
        captured.params = params;
        return {
          url: "u",
          query: "q",
          content: "c",
          stats: {
            totalChars: 1,
            startFromChar: 0,
            returnedChars: 1,
            truncated: false,
            nextStartChar: null,
            linksCount: 0,
            imagesCount: 0,
          },
        };
      },
    } as unknown as Page;

    await executeAction(page, {
      name: "extract_content",
      params: { query: "q", alreadyCollected: ["https://x/1", "https://x/2"] },
    });

    expect(captured.params?.alreadyCollected).toEqual(["https://x/1", "https://x/2"]);
  });

  test("routes markdown through extractionLLM when schemaJson is supplied", async () => {
    const page = {
      extractContent: async () => ({
        url: "https://example.com",
        query: "jobs",
        content: "# job 1\n# job 2",
        stats: {
          totalChars: 14,
          startFromChar: 0,
          returnedChars: 14,
          truncated: false,
          nextStartChar: null,
          linksCount: 0,
          imagesCount: 0,
        },
      }),
    } as unknown as Page;

    const captured: { markdown?: string; schemaJson?: string; query?: string } = {};
    const result = await executeAction(
      page,
      {
        name: "extract_content",
        params: { query: "jobs", schemaJson: '{"type":"array"}' },
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async (input) => {
        captured.markdown = input.markdown;
        captured.schemaJson = input.schemaJson;
        captured.query = input.query;
        return { data: [{ title: "job 1" }, { title: "job 2" }] };
      },
    );

    expect(result.ok).toBe(true);
    expect(captured.markdown).toBe("# job 1\n# job 2");
    expect(captured.schemaJson).toBe('{"type":"array"}');
    expect(captured.query).toBe("jobs");
    const data = result.data as { structured?: unknown };
    expect(data.structured).toEqual([{ title: "job 1" }, { title: "job 2" }]);
  });

  test("schemaJson without an extractionLLM hook is ignored", async () => {
    const page = {
      extractContent: async () => ({
        url: "u",
        query: "q",
        content: "c",
        stats: {
          totalChars: 1,
          startFromChar: 0,
          returnedChars: 1,
          truncated: false,
          nextStartChar: null,
          linksCount: 0,
          imagesCount: 0,
        },
      }),
    } as unknown as Page;

    const result = await executeAction(page, {
      name: "extract_content",
      params: { query: "q", schemaJson: '{"type":"object"}' },
    });

    expect(result.ok).toBe(true);
    const data = result.data as { structured?: unknown; structuredError?: string };
    expect(data.structured).toBeUndefined();
    expect(data.structuredError).toBeUndefined();
  });

  test("extractionLLM rejection surfaces as data.structuredError without failing the action", async () => {
    const page = {
      extractContent: async () => ({
        url: "u",
        query: "q",
        content: "c",
        stats: {
          totalChars: 1,
          startFromChar: 0,
          returnedChars: 1,
          truncated: false,
          nextStartChar: null,
          linksCount: 0,
          imagesCount: 0,
        },
      }),
    } as unknown as Page;

    const result = await executeAction(
      page,
      {
        name: "extract_content",
        params: { query: "q", schemaJson: '{"type":"object"}' },
      },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      async () => {
        throw new Error("model returned 429");
      },
    );

    expect(result.ok).toBe(true);
    const data = result.data as { structured?: unknown; structuredError?: string };
    expect(data.structured).toBeUndefined();
    expect(data.structuredError).toBe("model returned 429");
  });

  test("classifies timeouts and surfaces structured data", async () => {
    const page = {
      extractContent: async () => {
        throw new Error("Operation timeout after 30000ms");
      },
    } as unknown as Page;
    const result = await executeAction(page, {
      name: "extract_content",
      params: { query: "x" },
    });

    expect(result.ok).toBe(false);
    expect(result.message).toContain("timeout");
    expect((result.data as { extractionError: { reason: string } }).extractionError.reason).toBe(
      "timeout",
    );
  });
});
