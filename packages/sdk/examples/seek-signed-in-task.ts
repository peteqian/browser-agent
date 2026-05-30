import { Browser, runTask } from "../src/index";

/**
 * Reuse a previously saved signed-in SEEK profile.
 *
 * The profile was created by signing into SEEK with headless: false and
 * fingerprintMode: "native", then letting the watcher copy the session
 * data to ~/.browser-agent/profiles/seek-signed-in/.
 *
 * Keep headless: false + fingerprintMode: "native" so cookies, storage,
 * and anti-bot signals stay tied to the same browser identity.
 */

const browser = new Browser({
  profile: "seek-signed-in",
  headless: false,
  fingerprintMode: "native",
});

try {
  const result = await runTask({
    browser,
    task: "Go to au.seek.com and confirm whether I am signed in. Then stop.",
  });

  console.log(result);
} finally {
  await browser.close();
}
