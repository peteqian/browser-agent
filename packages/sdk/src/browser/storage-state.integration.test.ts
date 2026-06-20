import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrowserSession } from "./session/session";

const runIntegration = process.env.BROWSER_AGENT_STORAGE_STATE_INTEGRATION === "1";
const integrationTest = runIntegration ? test : test.skip;

let server: Server | undefined;
let baseUrl = "";
let tempDir = "";

async function startFixtureServer(): Promise<string> {
  const fixture = createServer((req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (req.url === "/set") {
      res.setHeader("set-cookie", "storage-fixture=cookie-value; Path=/; SameSite=Lax");
      res.end(
        `<!doctype html><script>localStorage.setItem("storage-fixture", "local-value");</script>`,
      );
      return;
    }
    res.end("<!doctype html><body>Storage fixture</body>");
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
  tempDir = mkdtempSync(join(tmpdir(), "browser-agent-storage-state-"));
});

afterEach(async () => {
  await stopFixtureServer();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  baseUrl = "";
  tempDir = "";
});

describe("storage state browser integration", () => {
  integrationTest(
    "saves and restores cookies and localStorage",
    async () => {
      const storageStatePath = join(tempDir, "storage-state.json");
      const firstSession = await BrowserSession.launch({
        headless: true,
        maxRetries: 1,
        storageStatePath,
      });

      try {
        const page = await firstSession.newPage();
        await page.goto(`${baseUrl}/set`);
      } finally {
        await firstSession.close();
      }

      expect(existsSync(storageStatePath)).toBe(true);
      const saved = JSON.parse(readFileSync(storageStatePath, "utf8"));
      expect(
        saved.cookies.some((cookie: { name: string }) => cookie.name === "storage-fixture"),
      ).toBe(true);
      expect(saved.origins).toContainEqual({
        origin: baseUrl,
        localStorage: { "storage-fixture": "local-value" },
      });

      const secondSession = await BrowserSession.launch({
        headless: true,
        maxRetries: 1,
        storageStatePath,
        saveStorageStateOnClose: false,
      });
      try {
        const page = await secondSession.newPage();
        await page.goto(baseUrl);
        const restored = await page.evaluate<{
          cookie: string;
          localStorage: string | null;
        }>(`(() => ({
          cookie: document.cookie,
          localStorage: localStorage.getItem("storage-fixture"),
        }))()`);

        expect(restored.cookie).toContain("storage-fixture=cookie-value");
        expect(restored.localStorage).toBe("local-value");
        expect(
          secondSession.eventBus.history.some(
            (event) => event.type === "browser_event" && event.name === "storage_state_loaded",
          ),
        ).toBe(true);
      } finally {
        await secondSession.close().catch(() => {});
      }
    },
    45_000,
  );
});
