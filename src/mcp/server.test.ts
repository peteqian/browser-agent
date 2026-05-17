import { describe, expect, test } from "bun:test";

import type { BrowserSession, Page } from "../browser/session";
import { registerSession } from "./sessions";
import { recordArtifact, sweepIdleSessions, shutdownAllSessions } from "./server";
import type { SessionArtifact } from "./server";

// Internal-state probes: this test exercises sweep semantics by reaching
// through the same module-scoped sessions map via a fresh import. Keep
// the surface minimal — server.test should not depend on a live MCP
// transport. Instead we drive sweepIdleSessions directly and assert
// behavior on a fake session object that satisfies the record shape.

describe("sweepIdleSessions", () => {
  test("removes nothing when the map is empty", async () => {
    await shutdownAllSessions();
    const expired = await sweepIdleSessions();
    expect(expired).toEqual([]);
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
