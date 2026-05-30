import type { LaunchOptions } from "../cdp/launch";
import { resolveBrowserPaths } from "./profile-paths";
import { BrowserSession, type Page } from "./session";

export interface BrowserOptions extends LaunchOptions {
  /**
   * Connect to an existing Chrome DevTools endpoint instead of launching a
   * local browser.
   */
  cdpUrl?: string;
  /**
   * Named persistent profile stored under ~/.browser-agent/profiles/<name>.
   * Reuses cookies/localStorage between runs while still launching Chrome in
   * CDP debug mode.
   */
  profile?: string;
}

/**
 * Easy browser handle for normal consumers.
 *
 * It starts lazily, so users can create `new Browser()` and pass it to an
 * `Agent` without learning the lower-level session lifecycle first.
 */
export class Browser {
  private readonly options: BrowserOptions;
  private sessionPromise: Promise<BrowserSession> | null = null;

  constructor(options: BrowserOptions = {}) {
    this.options = options;
  }

  async getSession(): Promise<BrowserSession> {
    if (this.sessionPromise) return this.sessionPromise;

    this.sessionPromise = this.start();
    return this.sessionPromise;
  }

  async newPage(): Promise<Page> {
    const session = await this.getSession();
    return session.newPage();
  }

  async close(): Promise<void> {
    if (!this.sessionPromise) return;

    const session = await this.sessionPromise;
    await session.close();
    this.sessionPromise = null;
  }

  private async start(): Promise<BrowserSession> {
    const { cdpUrl, profile, userDataDir, storageStatePath, ...launchOptions } = this.options;
    const paths = resolveBrowserPaths({ profile, userDataDir, storageStatePath });
    const session = new BrowserSession({
      cdpUrl,
      launch: {
        ...launchOptions,
        userDataDir: paths.userDataDir,
        storageStatePath: paths.storageStatePath,
      },
    });
    await session.start();
    return session;
  }
}
