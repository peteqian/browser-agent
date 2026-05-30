/**
 * Download capture example.
 *
 * Launches a Chromium session with a `downloadsDir` so the watchdog routes
 * downloaded files there, then opens a tiny in-process HTTP server that serves
 * a `Content-Disposition: attachment` response. Listens on
 * `BrowserSession.eventBus` for `download_started` / `download_completed`
 * events and prints the saved path.
 *
 * Run:
 *   bun run examples/downloads.ts
 */
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrowserSession } from "../src/index";

const downloadsDir = mkdtempSync(join(tmpdir(), "browser-agent-downloads-example-"));

const server = createServer((req, res) => {
  if (req.url === "/file") {
    res.setHeader("content-disposition", 'attachment; filename="hello.txt"');
    res.setHeader("content-type", "application/octet-stream");
    res.end("hello from browser-agent downloads example\n");
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end('<a href="/file" download>download me</a>');
});
const baseUrl: string = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    if (addr && typeof addr === "object") resolve(`http://127.0.0.1:${addr.port}`);
  });
});

const session = await BrowserSession.launch({ headless: true, downloadsDir });
const unsubscribe = session.eventBus.on((event) => {
  if (event.type === "browser_event" && event.name.startsWith("download_")) {
    console.log(`[${event.name}]`, event.data);
  }
});

try {
  const page = await session.newPage();
  await page.goto(`${baseUrl}/file`).catch(() => {
    // navigation cancels because the response is an attachment
  });

  // Wait briefly for download_completed to fire.
  for (let i = 0; i < 50; i += 1) {
    if (
      session.eventBus.history.some(
        (e) => e.type === "browser_event" && e.name === "download_completed",
      )
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 100));
  }

  const completed = session.eventBus.history.find(
    (e) => e.type === "browser_event" && e.name === "download_completed",
  );
  if (completed && completed.type === "browser_event") {
    const data = completed.data as { path?: string };
    if (data.path) {
      console.log("file contents:", JSON.stringify(readFileSync(data.path, "utf8")));
    }
  }
} finally {
  unsubscribe();
  await session.close();
  server.close();
  rmSync(downloadsDir, { recursive: true, force: true });
}
