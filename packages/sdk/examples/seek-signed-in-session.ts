import { BrowserSession } from "../src/index";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Low-level example: drive a saved SEEK profile with BrowserSession.
 *
 * Useful when you want full control over navigation and do not need the
 * LLM decision loop.
 *
 * The profile path follows ~/.browser-agent/profiles/<name>/user-data/.
 * For a simpler API that resolves the profile name for you, use Browser
 * (see seek-signed-in-task.ts).
 */

const profileDir = join(homedir(), ".browser-agent", "profiles", "seek-signed-in", "user-data");

const session = await BrowserSession.launch({
  userDataDir: profileDir,
  headless: false,
  fingerprintMode: "native",
});

try {
  const page = await session.newPage();
  await page.goto("https://au.seek.com/");
  console.log(await page.title());
} finally {
  await session.close();
}
