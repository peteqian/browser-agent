import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AddressInfo } from "node:net";

import type { BrowserEvent } from "./events";
import { BrowserSession } from "./session";

type BrowserRuntimeEvent = Extract<BrowserEvent, { type: "browser_event" }>;

const runIntegration = process.env.BROWSER_AGENT_DOWNLOAD_WATCHDOG_INTEGRATION === "1";
const integrationTest = runIntegration ? test : test.skip;

let server: Server | undefined;
let baseUrl = "";
let downloadsDir = "";

async function startFixtureServer(): Promise<string> {
  const fixture = createServer((req, res) => {
    if (req.url === "/download") {
      res.setHeader("content-type", "text/plain; charset=utf-8");
      res.setHeader("content-disposition", 'attachment; filename="fixture-download.txt"');
      res.end("download watchdog fixture\n");
      return;
    }

    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html><body><a href="/download" download>Download fixture</a></body></html>',
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

async function waitForCompletedDownload(
  events: BrowserRuntimeEvent[],
): Promise<BrowserRuntimeEvent> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    const event = events.find((item) => item.name === "download_completed");
    if (event) return event;
    await delay(100);
  }
  throw new Error("Timed out waiting for download_completed event");
}

beforeEach(async () => {
  if (!runIntegration) return;
  baseUrl = await startFixtureServer();
  downloadsDir = mkdtempSync(join(tmpdir(), "browser-agent-downloads-"));
});

afterEach(async () => {
  await stopFixtureServer();
  if (downloadsDir) {
    rmSync(downloadsDir, { recursive: true, force: true });
  }
  baseUrl = "";
  downloadsDir = "";
});

describe("download watchdog browser integration", () => {
  integrationTest(
    "emits download events and saves files to configured downloadsDir",
    async () => {
      const session = await BrowserSession.launch({
        headless: true,
        maxRetries: 1,
        downloadsDir,
      });
      const events: BrowserRuntimeEvent[] = [];
      session.eventBus.on((event) => {
        if (event.type === "browser_event" && event.name.startsWith("download_")) {
          events.push(event);
        }
      });

      try {
        const page = await session.newPage();
        await page.goto(`${baseUrl}/download`, "domcontentloaded").catch(() => {
          // Download navigations may not produce a document load; watchdog events are authoritative here.
        });

        const completed = await waitForCompletedDownload(events);
        const data = completed.data as {
          path?: string;
          suggestedFilename?: string;
          state?: string;
        };
        expect(data.state).toBe("completed");
        expect(data.suggestedFilename).toBe("fixture-download.txt");
        expect(data.path).toBeString();
        expect(existsSync(data.path!)).toBe(true);
        expect(readFileSync(data.path!, "utf8")).toBe("download watchdog fixture\n");
        expect(
          session.eventBus.history.some(
            (event) => event.type === "browser_event" && event.name === "download_watchdog_enabled",
          ),
        ).toBe(true);
        expect(events.some((event) => event.name === "download_started")).toBe(true);
      } finally {
        await session.close().catch(() => {
          // Best-effort cleanup for local browser integration runs.
        });
      }
    },
    45_000,
  );
});
