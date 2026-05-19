/**
 * Annotated screenshot example.
 *
 * Captures a snapshot, then overlays numeric `[index]` labels on each
 * interactive element before writing the screenshot to `./annotated.png`.
 *
 * Run:
 *   bun run examples/annotated-screenshot.ts [url]
 */
import { writeFile } from "node:fs/promises";

import { BrowserSession } from "../src/index";
import { captureCdpSnapshot, withBudgetDefaults } from "../src/dom/cdp-snapshot";

const url = process.argv[2] ?? "https://example.com";
const outputPath = "./annotated.png";

const session = await BrowserSession.launch({ headless: true });
try {
  const page = await session.newPage();
  await page.goto(url);
  const { snapshot } = await captureCdpSnapshot(page, withBudgetDefaults());
  const base64 = await page.screenshot({ annotate: true, snapshot });
  await writeFile(outputPath, Buffer.from(base64, "base64"));
  console.log(`Wrote annotated screenshot for ${snapshot.elements.length} elements to ${outputPath}`);
} finally {
  await session.close();
}
