import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  dashboardHtml,
  dashboardManifestPath,
  getDashboardStatus,
  readDashboardManifest,
  statusForError,
} from "./server";

describe("dashboard server", () => {
  test("renders the built-in dashboard shell", () => {
    const html = dashboardHtml();
    expect(html).toContain("browser-agent dashboard");
    expect(html).toContain("/api/sessions");
    expect(html).toContain("/api/events");
    expect(html).toContain('dataset.action = "close"');
    expect(html).toContain('{ method: "DELETE" }');
    expect(html).toContain("replaceChildren");
    expect(html).toContain("/snapshot");
    expect(html).toContain("/action");
    expect(html).toContain("activeSessionId");
    expect(html).toContain("catch (error)");
    expect(html).toContain("refreshActiveSession");
    expect(html).toContain("selectSession(created.sessionId)");
  });

  test("ignores malformed daemon manifests", () => {
    const home = temporaryHome();
    try {
      mkdirSync(home.path, { recursive: true });
      writeFileSync(dashboardManifestPath(), "{not json");

      expect(readDashboardManifest()).toBeNull();
    } finally {
      home.dispose();
    }
  });

  test("status removes stale manifests after a failed health check", async () => {
    const home = temporaryHome();
    try {
      mkdirSync(home.path, { recursive: true });
      writeFileSync(
        dashboardManifestPath(),
        JSON.stringify({
          pid: process.pid,
          url: "http://127.0.0.1:9",
          startedAt: "2026-05-21T00:00:00.000Z",
        }),
      );

      const status = await getDashboardStatus({ cleanStale: true });

      expect(status.running).toBe(false);
      expect(existsSync(dashboardManifestPath())).toBe(false);
    } finally {
      home.dispose();
    }
  });

  test("classifies expected client errors", () => {
    expect(statusForError(new SyntaxError("bad json"))).toBe(400);
    expect(statusForError(new Error("Provide sessionId or profile."))).toBe(400);
    expect(statusForError(new Error("Invalid action name."))).toBe(400);
    expect(statusForError(new Error("Unsupported browser channel: netscape"))).toBe(400);
  });

  test("classifies missing sessions as not found", () => {
    expect(statusForError(new Error("Unknown sessionId: missing"))).toBe(404);
    expect(statusForError(new Error("No live session for profile: booking"))).toBe(404);
  });

  test("leaves unexpected errors as internal failures", () => {
    expect(statusForError(new Error("browser crashed"))).toBe(500);
  });
});

function temporaryHome() {
  const oldHome = process.env.BROWSER_AGENT_HOME;
  const path = mkdtempSync(join(tmpdir(), "browser-agent-dashboard-test-"));
  process.env.BROWSER_AGENT_HOME = path;
  return {
    path,
    dispose() {
      if (oldHome === undefined) {
        delete process.env.BROWSER_AGENT_HOME;
      } else {
        process.env.BROWSER_AGENT_HOME = oldHome;
      }
      rmSync(path, { recursive: true, force: true });
    },
  };
}
