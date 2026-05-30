/**
 * Storage state persistence example.
 *
 * Launches a session against an inline HTML page that writes a localStorage
 * entry, closes the session (saving state to a JSON file), then re-launches
 * against the same `storageStatePath` and reads the value back.
 *
 * Run:
 *   bun run examples/storage-state.ts
 */
import { createServer } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrowserSession } from "../src/index";

const tmp = mkdtempSync(join(tmpdir(), "browser-agent-storage-example-"));
const storageStatePath = join(tmp, "state.json");

const writerHtml = `<!doctype html><html><body>
  <script>localStorage.setItem('demo', 'persisted-' + Date.now());</script>
  wrote.
</body></html>`;
const readerHtml = `<!doctype html><html><body>
  <pre id="out"></pre>
  <script>document.getElementById('out').textContent = localStorage.getItem('demo') ?? '(empty)';</script>
</body></html>`;

const server = createServer((req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(req.url === "/read" ? readerHtml : writerHtml);
});
const baseUrl: string = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    if (addr && typeof addr === "object") resolve(`http://127.0.0.1:${addr.port}`);
  });
});

try {
  // Pass 1: write to localStorage and persist on close.
  const writeSession = await BrowserSession.launch({ headless: true, storageStatePath });
  const writePage = await writeSession.newPage();
  await writePage.goto(`${baseUrl}/write`);
  await writeSession.close();

  // Pass 2: re-launch against the same storage path and read it back.
  const readSession = await BrowserSession.launch({ headless: true, storageStatePath });
  const readPage = await readSession.newPage();
  await readPage.goto(`${baseUrl}/read`);
  const value = await readPage.evaluate<string>("document.getElementById('out').textContent");
  console.log("restored value:", value);
  await readSession.close();
} finally {
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
