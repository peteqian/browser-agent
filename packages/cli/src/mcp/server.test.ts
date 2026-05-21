import { describe, expect, test } from "bun:test";

import type { BrowserSession, Page } from "@peteqian/browser-agent-sdk";
import type { BrowserStateSummary } from "@peteqian/browser-agent-sdk";
import type { Action } from "@peteqian/browser-agent-sdk/internal";
import { indexFromRef, runSessionAction, runSessionActions } from "./helpers";
import {
  findSessionByProfile,
  listSessionEvents,
  listSessionRecords,
  recordSessionEvent,
  registerSession,
} from "./sessions";
import { recordArtifact, sweepIdleSessions, shutdownAllSessions } from "./server";
import type { SessionArtifact } from "./server";

// Internal-state probes: this test exercises sweep semantics by reaching
// through the same module-scoped sessions map via a fresh import. Keep
// the surface minimal — server.test should not depend on a live MCP
// transport. Instead we drive sweepIdleSessions directly and assert
// behavior on a fake session object that satisfies the record shape.

describe("indexFromRef", () => {
  test("accepts @eN refs and numeric indices", () => {
    expect(indexFromRef({ ref: "@e12" })).toBe(12);
    expect(indexFromRef({ ref: "e3" })).toBe(3);
    expect(indexFromRef({ index: 4, ref: "@e9" })).toBe(4);
    expect(indexFromRef({ ref: "button-3" })).toBeUndefined();
  });
});

describe("runSessionAction", () => {
  test("uses cached selector map and snapshot elements from the latest observation", async () => {
    const calls: Action[] = [];
    const page = {
      targetId: "page-1",
      clickByBackendNodeId: async (backendNodeId: number) => {
        expect(backendNodeId).toBe(123);
        return { ok: true };
      },
      waitForStablePage: async () => {},
      getPendingNetworkRequests: async () => [],
      evaluate: async (expression: string) => {
        if (expression.includes("window.innerWidth")) return { width: 800, height: 600 };
        return "";
      },
      sendCDP: async () => ({ documents: [], strings: [], layout: { nodeIndex: [] } }),
    } as unknown as Page;
    const record = {
      session: {
        listPageTargetIds: async () => ["page-1"],
        waitForNewPageTarget: async () => null,
      } as unknown as BrowserSession,
      page,
      lastAccessedAt: Date.now(),
      artifacts: [],
      latestState: {
        selectorMap: { byIndex: new Map([[7, { backendNodeId: 123 }]]) },
        elements: [
          {
            index: 7,
            backendNodeId: 123,
            framePath: "main",
            tag: "button",
            role: "button",
            text: "Search",
            href: null,
            name: null,
            ariaName: "Search",
            type: null,
            placeholder: null,
            value: null,
            ariaLabel: null,
            selectorHint: "button",
            bbox: { x: 0, y: 0, w: 80, h: 30 },
            axRole: "button",
            axName: "Search",
            testId: null,
            dataAttrs: {},
            labelText: null,
            stableHandle: { kind: "role", value: 'role=button name="Search"' },
            stableId: "abc12345",
          },
        ],
      } as BrowserStateSummary,
    };
    const result = await runSessionAction(
      record,
      { name: "click", params: { index: 7 } },
      { observe: false },
    );
    const body = JSON.parse(result.content[0].text);
    calls.push({ name: "click", params: { index: 7 } });
    expect(body.ok).toBe(true);
    expect(record.latestState).toBeDefined();
    expect(calls).toHaveLength(1);
    expect(record.events?.[0]?.name).toBe("click");
    expect(record.events?.[0]?.ok).toBe(true);
  });

  test("records saved screenshot artifacts from shared action runner", async () => {
    const record = {
      session: {
        listPageTargetIds: async () => ["page-1"],
        waitForNewPageTarget: async () => null,
      } as unknown as BrowserSession,
      page: {
        targetId: "page-1",
        currentUrl: async () => "https://example.com/",
        screenshotToFile: async (fileName: string) => `/tmp/${fileName}`,
      } as unknown as Page,
      lastAccessedAt: Date.now(),
      artifacts: [],
    };

    const result = await runSessionAction(
      record,
      { name: "screenshot", params: { fileName: "saved.png" } },
      { observe: false },
    );
    const body = JSON.parse(result.content[0].text);

    expect(body.ok).toBe(true);
    expect(record.artifacts).toEqual([
      { kind: "screenshot", path: "/tmp/saved.png", createdAt: expect.any(Number) },
    ]);
  });

  test("runSessionActions stops after the first failed action", async () => {
    const clicked: number[] = [];
    const page = {
      targetId: "page-1",
      currentUrl: async () => "https://example.com/",
      clickByBackendNodeId: async (backendNodeId: number) => {
        clicked.push(backendNodeId);
        return backendNodeId === 123 ? { ok: true } : { ok: false, reason: "blocked" };
      },
      waitForStablePage: async () => {},
      getPendingNetworkRequests: async () => [],
      evaluate: async (expression: string) => {
        if (expression.includes("window.innerWidth")) return { width: 800, height: 600 };
        return "";
      },
      sendCDP: async () => ({ documents: [], strings: [], layout: { nodeIndex: [] } }),
    } as unknown as Page;
    const record = {
      session: {
        listPageTargetIds: async () => ["page-1"],
        waitForNewPageTarget: async () => null,
      } as unknown as BrowserSession,
      page,
      lastAccessedAt: Date.now(),
      artifacts: [],
      latestState: {
        url: "https://example.com/",
        selectorMap: {
          byIndex: new Map([
            [1, { backendNodeId: 123 }],
            [2, { backendNodeId: 456 }],
            [3, { backendNodeId: 789 }],
          ]),
        },
        elements: [],
      } as unknown as BrowserStateSummary,
    };
    const result = await runSessionActions(
      record,
      [
        { name: "click", params: { index: 1 } },
        { name: "click", params: { index: 2 } },
        { name: "click", params: { index: 3 } },
      ],
      { observe: false },
    );
    const body = JSON.parse(result.content[0].text);
    expect(body.ok).toBe(false);
    expect(body.results).toHaveLength(2);
    expect(clicked).toEqual([123, 456]);
    expect(record.events?.map((event) => event.name)).toEqual(["click", "click"]);
    expect(record.events?.map((event) => event.ok)).toEqual([true, false]);
  });
});

describe("sweepIdleSessions", () => {
  test("removes nothing when the map is empty", async () => {
    await shutdownAllSessions();
    const expired = await sweepIdleSessions();
    expect(expired).toEqual([]);
  });
});

describe("session registry lookup", () => {
  test("lists sessions and finds the most recently used profile session", async () => {
    await shutdownAllSessions();
    const fakePage = {} as Page;
    registerSession("sess_old", {
      session: { close: async () => {} } as unknown as BrowserSession,
      page: fakePage,
      createdAt: 1,
      lastAccessedAt: 10,
      artifacts: [],
      profile: "booking",
    });
    registerSession("sess_new", {
      session: { close: async () => {} } as unknown as BrowserSession,
      page: fakePage,
      createdAt: 2,
      lastAccessedAt: 20,
      artifacts: [],
      profile: "booking",
    });

    expect(listSessionRecords().map(([id]) => id)).toEqual(["sess_old", "sess_new"]);
    expect(findSessionByProfile("booking")?.[0]).toBe("sess_new");
    expect(findSessionByProfile("missing")).toBeUndefined();
    await shutdownAllSessions();
  });

  test("records bounded session events in insertion order", () => {
    const record = {
      session: {} as BrowserSession,
      page: {} as Page,
      lastAccessedAt: 1,
      artifacts: [],
    };
    recordSessionEvent(record, { kind: "lifecycle", name: "launch_session", ok: true });
    recordSessionEvent(record, {
      kind: "action",
      name: "click",
      ok: false,
      message: "blocked",
      durationMs: 12,
      url: "https://example.com/",
    });

    expect(listSessionEvents(record, 1)).toEqual([
      {
        id: 2,
        kind: "action",
        name: "click",
        createdAt: expect.any(Number),
        ok: false,
        message: "blocked",
        durationMs: 12,
        url: "https://example.com/",
      },
    ]);
  });
});

describe("shutdownAllSessions", () => {
  test("calls close() on every registered session and clears the map", async () => {
    await shutdownAllSessions();
    let closedA = 0;
    let closedB = 0;
    const fakePage = {} as Page;
    registerSession("sess_a", {
      session: { close: async () => void (closedA += 1) } as unknown as BrowserSession,
      page: fakePage,
      lastAccessedAt: Date.now(),
      artifacts: [],
    });
    registerSession("sess_b", {
      session: { close: async () => void (closedB += 1) } as unknown as BrowserSession,
      page: fakePage,
      lastAccessedAt: Date.now(),
      artifacts: [],
    });
    await shutdownAllSessions();
    expect(closedA).toBe(1);
    expect(closedB).toBe(1);
    expect(await sweepIdleSessions()).toEqual([]);
  });

  test("survives a close() that throws", async () => {
    await shutdownAllSessions();
    const fakePage = {} as Page;
    registerSession("sess_throws", {
      session: {
        close: async () => {
          throw new Error("boom");
        },
      } as unknown as BrowserSession,
      page: fakePage,
      lastAccessedAt: Date.now(),
      artifacts: [],
    });
    await shutdownAllSessions();
    expect(await sweepIdleSessions()).toEqual([]);
  });
});

describe("recordArtifact", () => {
  test("pushes path from result.data.path", () => {
    const rec: { artifacts: SessionArtifact[] } = { artifacts: [] };
    const result = { ok: true, data: { path: "/tmp/shot.png" } };
    const artifact = recordArtifact(rec, "screenshot", result, 1000);
    expect(artifact).toEqual({ kind: "screenshot", path: "/tmp/shot.png", createdAt: 1000 });
    expect(rec.artifacts).toHaveLength(1);
  });

  test("ignores result without data.path", () => {
    const rec: { artifacts: SessionArtifact[] } = { artifacts: [] };
    const inMemory = { ok: true, data: { base64: "iVBOR..." } };
    expect(recordArtifact(rec, "screenshot", inMemory)).toBeUndefined();
    expect(rec.artifacts).toHaveLength(0);
  });

  test("ignores non-object results", () => {
    const rec: { artifacts: SessionArtifact[] } = { artifacts: [] };
    expect(recordArtifact(rec, "pdf", null)).toBeUndefined();
    expect(recordArtifact(rec, "pdf", "ok")).toBeUndefined();
    expect(rec.artifacts).toHaveLength(0);
  });

  test("preserves insertion order across kinds", () => {
    const rec: { artifacts: SessionArtifact[] } = { artifacts: [] };
    recordArtifact(rec, "screenshot", { data: { path: "/a.png" } }, 1);
    recordArtifact(rec, "pdf", { data: { path: "/b.pdf" } }, 2);
    recordArtifact(rec, "screenshot", { data: { path: "/c.png" } }, 3);
    expect(rec.artifacts.map((a) => a.path)).toEqual(["/a.png", "/b.pdf", "/c.png"]);
  });
});
