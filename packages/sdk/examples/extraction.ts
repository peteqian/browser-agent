/**
 * Pagination-aware extraction example.
 *
 * Drives `page.extractContent` directly (no LLM) to demonstrate:
 *  - chunked extraction via `startFromChar` + `maxChars`
 *  - cross-page dedupe via `alreadyCollected`
 *  - structured result shape with link/image lists
 *
 * Point it at any URL with anchors; defaults to example.com.
 *
 * Run:
 *   bun run examples/extraction.ts [url]
 */
import { BrowserSession } from "../src/index";

const url = process.argv[2] ?? "https://example.com";

const session = await BrowserSession.launch({ headless: true });
try {
  const page = await session.newPage();
  await page.goto(url);

  const collected = new Set<string>();
  let cursor = 0;
  let pageNum = 0;
  const linkRegex = /\[[^\]]+\]\((https?:[^\s)]+)\)/g;

  while (pageNum < 5) {
    pageNum += 1;
    const chunk = await page.extractContent({
      query: "page summary",
      extractLinks: true,
      extractImages: false,
      startFromChar: cursor,
      maxChars: 4000,
      alreadyCollected: Array.from(collected),
    });

    let newLinks = 0;
    for (const match of chunk.content.matchAll(linkRegex)) {
      const link = match[1];
      if (link && !collected.has(link)) {
        collected.add(link);
        newLinks += 1;
      }
    }

    console.log(
      `[chunk ${pageNum}] ${chunk.stats.returnedChars}/${chunk.stats.totalChars} chars, ` +
        `${newLinks} new links (total ${collected.size})`,
    );

    if (!chunk.stats.truncated || chunk.stats.nextStartChar == null) break;
    cursor = chunk.stats.nextStartChar;
  }

  console.log(`Total unique links seen: ${collected.size}`);
} finally {
  await session.close();
}
