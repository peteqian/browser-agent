import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { BrowserSession } from "./session/session";

const runIntegration = process.env.BROWSER_AGENT_PERMISSIONS_WATCHDOG_INTEGRATION === "1";
const integrationTest = runIntegration ? test : test.skip;

let server: Server | undefined;
let baseUrl = "";

async function startFixtureServer(): Promise<string> {
  const fixture = createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end("<!doctype html><html><body>Permission fixture</body></html>");
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

describe("permissions watchdog browser integration", () => {
  integrationTest(
    "grants configured origin permissions",
    async () => {
      const session = await BrowserSession.launch({
        headless: true,
        maxRetries: 1,
        permissionGrants: [{ origin: baseUrl, permissions: ["geolocation"] }],
      });

      try {
        const page = await session.newPage();
        await page.goto(baseUrl);
        const state = await page.evaluate<string>(
          'navigator.permissions.query({ name: "geolocation" }).then((permission) => permission.state)',
        );

        expect(state).toBe("granted");
        expect(session.eventBus.history).toContainEqual({
          type: "browser_event",
          name: "permissions_watchdog_enabled",
          data: { origin: baseUrl, permissions: ["geolocation"] },
        });
      } finally {
        await session.close().catch(() => {
          // Best-effort cleanup for local browser integration runs.
        });
      }
    },
    45_000,
  );
});
