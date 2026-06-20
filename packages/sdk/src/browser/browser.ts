import type { LaunchOptions } from "../cdp/launch";
import { resolveBrowserPaths } from "./identity/profile-paths";
import { ProxyPool } from "./identity/proxy-pool";
import { BrowserSession, type Page } from "./session/session";

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
  /**
   * Rotate the launch proxy from a pool. When set, the next proxy is picked
   * at session start and overrides `proxyServer`/`proxyBypass`. Ignored when
   * connecting to an existing `cdpUrl` (no launch happens). See ProxyPool.
   */
  proxyPool?: ProxyPool;
}

/**
 * Easy browser handle for normal consumers.
 *
 * It starts lazily, so users can create `new Browser()` and pass it to an
 * `Agent` without learning the lower-level session lifecycle first.
 *
 * For a real user-controlled browser, pass `cdpUrl` and
 * `fingerprintMode: "native"` so the session preserves the browser's real
 * JS-visible surface instead of installing stealth patches.
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

  async kill(): Promise<void> {
    if (!this.sessionPromise) return;

    const session = await this.sessionPromise;
    await session.kill();
    this.sessionPromise = null;
  }

  private async start(): Promise<BrowserSession> {
    const { cdpUrl, profile, userDataDir, storageStatePath, proxyPool, ...launchOptions } =
      this.options;
    const paths = resolveBrowserPaths({ profile, userDataDir, storageStatePath });
    // Pick a proxy from the pool for this launch (overrides any static
    // proxyServer). No-op when attaching to an existing cdpUrl.
    const proxy = proxyPool && !cdpUrl ? ProxyPool.toLaunchOptions(proxyPool.next()) : {};
    const session = new BrowserSession({
      cdpUrl,
      launch: {
        ...launchOptions,
        ...proxy,
        userDataDir: paths.userDataDir,
        storageStatePath: paths.storageStatePath,
      },
    });
    await session.start();
    return session;
  }
}
