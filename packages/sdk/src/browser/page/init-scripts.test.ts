import { describe, expect, test } from "bun:test";

import type { CDPClient } from "../../cdp/client";
import { BrowserProfile } from "../identity/profile";
import { enableDomains } from "../session/session-setup";

interface SendCall {
  method: string;
  params: unknown;
  sessionId: string | undefined;
}

function recordingClient(): { client: CDPClient; calls: SendCall[] } {
  const calls: SendCall[] = [];
  const client = {
    send: async (method: string, params?: unknown, sessionId?: string) => {
      calls.push({ method, params, sessionId });
      return {} as never;
    },
  } as unknown as CDPClient;
  return { client, calls };
}

function initScriptSources(calls: SendCall[]): string[] {
  return calls
    .filter((c) => c.method === "Page.addScriptToEvaluateOnNewDocument")
    .map((c) => (c.params as { source: string }).source);
}

describe("profile initScripts", () => {
  test("BrowserProfile copies the initScripts array defensively", () => {
    const sources = ["window.__a = 1"];
    const profile = new BrowserProfile({ initScripts: sources });
    sources.push("window.__b = 2");
    expect(profile.initScripts).toEqual(["window.__a = 1"]);
  });

  test("enableDomains registers each initScript on the new document", async () => {
    const { client, calls } = recordingClient();
    const profile = new BrowserProfile({
      initScripts: ["window.__token = 'abc'", "window.__now = () => 0"],
    });

    await enableDomains(client, "s1", profile, []);

    const sources = initScriptSources(calls);
    expect(sources).toContain("window.__token = 'abc'");
    expect(sources).toContain("window.__now = () => 0");
  });

  test("empty / non-string entries are skipped", async () => {
    const { client, calls } = recordingClient();
    const profile = new BrowserProfile({
      initScripts: ["", "window.__x = 1"],
    });

    await enableDomains(client, "s1", profile, []);

    const sources = initScriptSources(calls);
    expect(sources.filter((s) => s.length === 0)).toEqual([]);
    expect(sources).toContain("window.__x = 1");
  });

  test("scripts are registered against the supplied sessionId", async () => {
    const { client, calls } = recordingClient();
    const profile = new BrowserProfile({ initScripts: ["window.__y = 1"] });
    await enableDomains(client, "session-42", profile, []);
    const matching = calls.filter(
      (c) =>
        c.method === "Page.addScriptToEvaluateOnNewDocument" &&
        (c.params as { source: string }).source === "window.__y = 1",
    );
    expect(matching.length).toBe(1);
    expect(matching[0]?.sessionId).toBe("session-42");
  });
});
