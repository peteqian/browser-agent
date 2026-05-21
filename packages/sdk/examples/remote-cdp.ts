import { BrowserSession } from "../src/index";

const cdpUrl = process.env.BROWSER_AGENT_CDP_URL;

if (!cdpUrl) {
  console.error(
    "Set BROWSER_AGENT_CDP_URL to a Chrome DevTools WebSocket URL, for example ws://127.0.0.1:9222/devtools/browser/...",
  );
  process.exit(1);
}

const session = await BrowserSession.connect(cdpUrl, {
  profile: {
    // Remote browsers are often owned by another process. Disable reconnect so
    // the example reports a closed socket instead of trying to relaunch Chrome.
    reconnectOnDisconnect: false,
  },
});

try {
  const pages = await session.listPages();
  const page = pages[0] ?? (await session.newPage());

  await page.goto("https://example.com");

  const title = await page.title();
  const heading = await page.evaluate<string>(
    "document.querySelector('h1')?.textContent ?? '(no h1)'",
  );

  console.log({ title, heading, targetId: page.targetId });
} finally {
  await session.close();
}
