import { BrowserSession, type Page } from "../browser/session/session";

import { startFixtureServer, type FixturePages, type FixtureServer } from "./fixtureServer";

export interface IntegrationContext {
  baseUrl: string;
  session: BrowserSession;
  page: Page;
}

/**
 * Run `handler` against a fresh BrowserSession + fixture HTTP server,
 * tearing both down regardless of outcome. Integration tests are gated
 * behind the `BAGENT_INT=1` env var because they require a real Chrome
 * launch, which is unavailable in many CI sandboxes. Use
 * `describeIfIntegration` / `testIfIntegration` to opt in.
 */
export async function withIntegrationContext(
  handler: (ctx: IntegrationContext) => Promise<void>,
  pages?: FixturePages,
): Promise<void> {
  let server: FixtureServer | undefined;
  let session: BrowserSession | undefined;
  try {
    server = await startFixtureServer(pages);
    session = await BrowserSession.launch({ headless: true });
    const page = await session.newPage();
    await handler({ baseUrl: server.url, session, page });
  } finally {
    if (session) await session.close().catch(() => {});
    if (server) await server.stop().catch(() => {});
  }
}

export const integrationEnabled = process.env.BAGENT_INT === "1";
