import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

import { Agent, Browser } from "../../../src/index";

const OUT = dirname(fileURLToPath(import.meta.url));
mkdirSync(OUT, { recursive: true });

const browser = new Browser({ autoConsent: true });
const LOG_FILE = join(OUT, "log.txt");
writeFileSync(LOG_FILE, "");
const append = (line: string) => appendFileSync(LOG_FILE, `${line}\n`);

const agent = new Agent({
  task: [
    "Goal: list hotels in San Francisco from booking.com for check-in 2026-06-10 to check-out 2026-06-15, sorted by price (lowest first). Return the top 10 with rank/name/price plus the active sort label in a freeform numbered text list inside the final `done.summary` field — DO NOT use done.data.",
    "",
    "Plan (target ≤8 steps total — batch multiple atomic actions per turn when no observation is needed between them):",
    "  step 1: navigate to https://www.booking.com",
    "  step 2: in one `actions` array, batch: type_by({label:'Where are you going?'}) 'San Francisco'  →  click_by({role:'button', name:'Search'})",
    "  step 3: pick the SF result from the autocomplete via click_by, then open the date picker, then click_by date 2026-06-10, then click_by date 2026-06-15, then click_by search submit — all in one actions array if the UI supports it",
    "  step 4: once on /searchresults.html, click_by({role:'button', name:/sort/i}) and then click_by the 'Price (lowest first)' option",
    "  step 5: extract_content with query='top 10 hotels with prices in display order'",
    "  step 6: done with success=true and summary containing the formatted numbered list",
    "",
    "Discipline: do NOT call extract_content more than twice. Do NOT call find_elements. If extract_content already returned the listings, just emit `done`. If a click_by fails ambiguous, refine with role+name or nth — never retry identical args.",
  ].join("\n"),
  browser,
  startUrl: "about:blank",
  maxSteps: 18,
  vision: true,
  onEvent: (e) => {
    if (e.type === "screenshot") {
      const path = join(OUT, `step-${String(e.step).padStart(2, "0")}.png`);
      writeFileSync(path, Buffer.from(e.screenshot.base64, "base64"));
      append(`[step ${e.step}] screenshot -> ${path}`);
    } else if (e.type === "action") {
      append(
        `[step ${e.step}] action ${e.action.name} ok=${e.result.ok} url=${e.url} msg=${e.result.message.slice(0, 200)}`,
      );
    } else if (e.type === "decision") {
      const d = e.decision as { thought?: string; nextGoal?: string };
      if (d.thought || d.nextGoal)
        append(`[step ${e.step}] plan: ${(d.nextGoal ?? d.thought ?? "").slice(0, 200)}`);
    } else if (e.type === "terminal") {
      append(`[terminal] success=${e.result.success} reason=${e.result.reason}`);
      append(`[terminal] summary:\n${e.result.summary ?? ""}`);
    }
  },
});

try {
  const result = await agent.run();
  append("=== FINAL ===");
  append(JSON.stringify(result, null, 2));
  writeFileSync(join(OUT, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
