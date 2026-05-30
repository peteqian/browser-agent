import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { BrowserSession } from "../browser/session";
import { captureBrowserState } from "../browser/state";

const runIntegration = process.env.BROWSER_AGENT_DOM_SNAPSHOT_INTEGRATION === "1";
const integrationTest = runIntegration ? test : test.skip;

const FIXTURE_HTML = `<!doctype html>
<html>
  <head><title>Snapshot fixture</title></head>
  <body>
    <button id="visible-btn">Visible</button>
    <button id="hidden-btn" style="display:none">Hidden</button>
    <button id="occluded-btn">Occluded</button>
    <div style="position:fixed;inset:0;background:red;z-index:9999"></div>
    <iframe id="frame" srcdoc="<button id='iframe-btn'>Inside iframe</button>"></iframe>
    <a href="/x" id="link-a">Link</a>
  </body>
</html>`;

let server: Server | undefined;
let baseUrl = "";

async function startFixtureServer(): Promise<string> {
  const fixture = createServer((_req, res) => {
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(FIXTURE_HTML);
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
});

describe("captureCdpSnapshot integration", () => {
  integrationTest(
    "captures visible interactive elements with backendNodeId map",
    async () => {
      const session = await BrowserSession.launch({ headless: true, maxRetries: 1 });
      try {
        const page = await session.newPage();
        await page.goto(baseUrl, "domcontentloaded");
        const state = await captureBrowserState(page, session);

        expect(state.elements.length).toBeGreaterThan(0);
        for (const entry of state.elements) {
          expect(typeof entry.backendNodeId).toBe("number");
        }
        const tags = state.elements.map((el) => el.tag);
        expect(tags).toContain("button");
        // hidden button must not appear
        const hidden = state.elements.find((el) => el.text.toLowerCase().includes("hidden"));
        expect(hidden).toBeUndefined();
      } finally {
        await session.close().catch(() => {});
      }
    },
    60_000,
  );

  integrationTest(
    "surfaces a deterministic stale-index failure when the element is removed",
    async () => {
      const session = await BrowserSession.launch({ headless: true, maxRetries: 1 });
      try {
        const page = await session.newPage();
        await page.goto(baseUrl, "domcontentloaded");
        const state = await captureBrowserState(page, session);
        const target = state.elements[0];
        expect(target).toBeDefined();

        await page.evaluate(`(() => {
          const candidates = document.querySelectorAll('button, a');
          for (const el of candidates) el.remove();
        })()`);

        const result = await page.clickByBackendNodeId(target!.backendNodeId);
        expect(result).toEqual({ ok: false, reason: "index_stale" });
      } finally {
        await session.close().catch(() => {});
      }
    },
    60_000,
  );
});
