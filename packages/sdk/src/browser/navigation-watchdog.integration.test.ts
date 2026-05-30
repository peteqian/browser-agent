import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { BrowserEvent } from "./events";
import { BrowserSession } from "./session";

type BrowserRuntimeEvent = Extract<BrowserEvent, { type: "browser_event" }>;

const runIntegration = process.env.BROWSER_AGENT_NAV_WATCHDOG_INTEGRATION === "1";
const integrationTest = runIntegration ? test : test.skip;

let server: Server | undefined;
let baseUrl = "";

async function startFixtureServer(): Promise<string> {
  const fixture = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url === "/empty") {
      res.end("<!doctype html><html><head><title>Empty</title></head><body></body></html>");
      return;
    }

    res.end(
      "<!doctype html><html><head><title>Normal</title></head><body><h1>Navigation fixture</h1></body></html>",
    );
  });

  await new Promise<void>((resolve, reject) => {
    fixture.once("error", reject);
    fixture.listen(0, "127.0.0.1", () => {
      fixture.off("error", reject);
      resolve();
    });
  });

  server = fixture;
  const address = fixture.address() as AddressInfo;
  return `http://127.0.0.1:${address.port}`;
}

async function stopFixtureServer(): Promise<void> {
  const current = server;
  server = undefined;
  if (!current) return;
  await new Promise<void>((resolve, reject) => {
    current.close((error) => (error ? reject(error) : resolve()));
  });
}

beforeEach(async () => {
  if (!runIntegration) return;
  baseUrl = await startFixtureServer();
});

afterEach(async () => {
  await stopFixtureServer();
  baseUrl = "";
});

describe("navigation watchdog browser integration", () => {
  integrationTest(
    "reports loaded and empty-page navigation health from local fixture pages",
    async () => {
      const session = await BrowserSession.launch({ headless: true, maxRetries: 1 });
      const events: BrowserRuntimeEvent[] = [];
      session.eventBus.on((event) => {
        if (event.type === "browser_event" && event.name === "navigation_watchdog") {
          events.push(event);
        }
      });

      try {
        const page = await session.newPage();

        const loaded = await page.navigateWithHealthCheck(`${baseUrl}/normal`);
        expect(loaded.ok).toBe(true);
        expect(loaded.status).toBe("loaded");
        expect(loaded.finalUrl).toBe(`${baseUrl}/normal`);
        expect(loaded.readyState).toBe("complete");

        const empty = await page.navigateWithHealthCheck(`${baseUrl}/empty`);
        expect(empty.ok).toBe(false);
        expect(empty.status).toBe("empty");
        expect(empty.finalUrl).toBe(`${baseUrl}/empty`);
        expect(empty.warning).toContain("empty content");

        const watchdogEvents = events.filter((event) => event.targetId === page.targetId);
        expect(watchdogEvents).toHaveLength(2);
        expect(watchdogEvents[0]?.data).toMatchObject({ status: "loaded", ok: true });
        expect(watchdogEvents[1]?.data).toMatchObject({ status: "empty", ok: false });
      } finally {
        await session.close().catch(() => {
          // Best-effort cleanup for local browser integration runs.
        });
      }
    },
    45_000,
  );
});
