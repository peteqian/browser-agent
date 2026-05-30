/**
 * File upload example.
 *
 * Serves a tiny HTML page with a hidden `<input type="file">` plus a visible
 * "Upload" button, then drives the new public helpers
 *   - `Page.findNearestFileInputBackendNodeId`
 *   - `Page.uploadFilesByBackendNodeId`
 * to attach a temp file to the form. Confirms via the form's `name` value
 * after the assignment.
 *
 * Run:
 *   bun run examples/upload.ts
 */
import { createServer } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrowserSession } from "../src/index";
import { serializePage } from "../src/internal";

const tmp = mkdtempSync(join(tmpdir(), "browser-agent-upload-example-"));
const filePath = join(tmp, "resume.txt");
writeFileSync(filePath, "demo resume contents\n");

const html = `<!doctype html><html><body>
  <form>
    <label id="picker">
      <button type="button" id="btn">Upload</button>
      <input type="file" name="resume" style="display:none" />
    </label>
    <div id="status">no file</div>
  </form>
  <script>
    document.querySelector('input[type=file]').addEventListener('change', (e) => {
      document.getElementById('status').textContent = 'got: ' + e.target.files[0]?.name;
    });
  </script>
</body></html>`;

const server = createServer((_, res) => {
  res.setHeader("content-type", "text/html");
  res.end(html);
});
const baseUrl: string = await new Promise((resolve) => {
  server.listen(0, "127.0.0.1", () => {
    const addr = server.address();
    if (addr && typeof addr === "object") resolve(`http://127.0.0.1:${addr.port}`);
  });
});

const session = await BrowserSession.launch({ headless: true });
try {
  const page = await session.newPage();
  await page.goto(baseUrl);

  // Find the visible button by snapshot.
  const { snapshot } = await serializePage(page);
  const btn = snapshot.elements.find((el) => el.text?.toLowerCase().includes("upload"));
  if (!btn) throw new Error("upload button not found in snapshot");

  // Walk from the button to the nearest <input type=file>.
  const lookup = await page.findNearestFileInputBackendNodeId(btn.backendNodeId);
  if (!lookup.ok) throw new Error(`file input not found near upload button: ${lookup.reason}`);

  await page.uploadFilesByBackendNodeId(lookup.backendNodeId, [filePath]);

  const status = await page.evaluate<string>("document.getElementById('status').textContent");
  console.log("status:", status);
} finally {
  await session.close();
  server.close();
  rmSync(tmp, { recursive: true, force: true });
}
