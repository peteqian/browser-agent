import { CDPClient } from "../cdp/client";
import { launchBrowserFromProfile, type LaunchOptions, type LaunchedBrowser } from "../cdp/launch";
import { BrowserProfile } from "./profile";
import { CaptchaWatchdog, type CaptchaWaitResult } from "./watchdogs/captcha";
import { BrowserEventBus } from "./events";
import type { BrowserStorageState } from "./storage-state";

import { Page } from "./page";
import {
  configureDownloads,
  configurePermissions,
  enableDomains,
  loadStorageState,
  saveStorageState,
} from "./session-setup";
import { wireCdpHandlers } from "./session-handlers";
import { reconnectIfNeeded } from "./session-reconnect";
import type {
  AttachedTargetEvent,
  BrowserSessionOptions,
  BrowserSessionState,
  DownloadInfo,
} from "./session-types";

export { Page } from "./page";
export type {
  BrowserSessionState,
  BrowserSessionOptions,
  PendingNetworkRequest,
  SearchPageParams,
  FindElementsParams,
  NavigationHealthStatus,
  NavigationHealthResult,
  ExtractContentParams,
  ExtractContentResult,
} from "./session-types";

export class BrowserSession {
  readonly profile: BrowserProfile;
  readonly eventBus = new BrowserEventBus();

  // INTERNAL: open to sibling helper modules in this folder. Not part of the
  // public API and may change without notice.
  browser: LaunchedBrowser | null = null;
  client: CDPClient | null = null;
  intentionalStop = false;
  reconnecting = false;

  readonly targetToSession = new Map<string, string>();
  readonly sessionToTarget = new Map<string, string>();
  readonly targetEnablePromises = new Map<string, Promise<void>>();
  readonly downloads = new Map<string, DownloadInfo>();

  private pageCache = new Map<string, Page>();
  private stateListeners = new Set<(state: BrowserSessionState) => void>();
  private loadedStorageState: BrowserStorageState | null = null;
  private state: BrowserSessionState = "idle";
  private captchaWatchdog = new CaptchaWatchdog();

  constructor(options: BrowserSessionOptions = {}) {
    this.profile = createProfile(options);
  }

  static async launch(options: LaunchOptions = {}): Promise<BrowserSession> {
    const session = new BrowserSession({ launch: options });
    await session.start();
    return session;
  }

  get currentState(): BrowserSessionState {
    return this.state;
  }

  onStateChange(handler: (state: BrowserSessionState) => void): () => void {
    this.stateListeners.add(handler);
    return () => this.stateListeners.delete(handler);
  }

  setState(state: BrowserSessionState): void {
    this.state = state;
    void this.eventBus.emit({ type: "browser_event", name: "state", data: { state } });
    for (const listener of this.stateListeners) listener(state);
  }

  ensureClient(): CDPClient {
    if (!this.client) throw new Error("Browser session is not connected");
    return this.client;
  }

  getSocketUrl(): string {
    if (this.profile.cdpUrl) return this.profile.cdpUrl;
    if (this.browser?.webSocketDebuggerUrl) return this.browser.webSocketDebuggerUrl;
    throw new Error("No CDP URL available for connection");
  }

  async start(): Promise<void> {
    this.intentionalStop = false;
    this.setState("launching");

    if (this.profile.isManagedLocal()) {
      this.browser = await launchBrowserFromProfile(this.profile);
    }

    this.setState("connecting");
    await this.connectToEndpoint(this.getSocketUrl());
    this.setState("connected");
  }

  async connectToEndpoint(wsUrl: string): Promise<void> {
    const client = new CDPClient(wsUrl);
    await client.waitForOpen();

    client.onClose(() => {
      if (this.intentionalStop) {
        this.setState("stopped");
        return;
      }
      this.setState("disconnected");
      void this.eventBus.emit({
        type: "browser_event",
        name: "cdp_disconnected",
        data: {
          reason: "websocket_closed",
          reconnectEnabled: this.profile.reconnectOnDisconnect,
        },
      });
      void reconnectIfNeeded(this);
    });

    this.client = client;

    if (this.profile.captchaSolver) this.captchaWatchdog.attach(client);

    this.loadedStorageState = await loadStorageState(client, this.profile, this.eventBus);
    await configurePermissions(client, this.profile, this.eventBus);
    await configureDownloads(client, this.profile, this.eventBus);

    wireCdpHandlers(client, this);

    await client.send("Target.setDiscoverTargets", { discover: true });
    await client.send("Target.setAutoAttach", {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: false,
    });

    await this.attachExistingPages();
  }

  enableDomainsForSession(sessionId: string): Promise<void> {
    return enableDomains(
      this.ensureClient(),
      sessionId,
      this.profile,
      this.loadedStorageState?.origins ?? [],
    );
  }

  private async attachExistingPages(): Promise<void> {
    const client = this.ensureClient();
    const response = await client.send<{ targetInfos?: Array<{ targetId: string; type: string }> }>(
      "Target.getTargets",
    );
    const targetInfos = response.targetInfos ?? [];
    for (const info of targetInfos) {
      if (info.type !== "page") continue;
      if (this.targetToSession.has(info.targetId)) continue;
      await this.attachTarget(info.targetId);
    }
  }

  private async attachTarget(targetId: string): Promise<string> {
    const client = this.ensureClient();
    const { sessionId } = await client.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const enablePromise = this.enableDomainsForSession(sessionId).finally(() => {
      this.targetEnablePromises.delete(targetId);
    });
    this.targetEnablePromises.set(targetId, enablePromise);
    await enablePromise;
    this.targetToSession.set(targetId, sessionId);
    this.sessionToTarget.set(sessionId, targetId);
    return sessionId;
  }

  private async getOrAttachSessionId(targetId: string): Promise<string> {
    const current = this.targetToSession.get(targetId);
    if (current) {
      await this.targetEnablePromises.get(targetId);
      const recheck = this.targetToSession.get(targetId);
      if (!recheck) {
        throw new Error(`Target ${targetId} is no longer available after domain enable failed`);
      }
      return recheck;
    }
    return this.attachTarget(targetId);
  }

  async sendToTarget<TResult = unknown>(
    targetId: string,
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<TResult> {
    const sessionId = await this.getOrAttachSessionId(targetId);
    return this.ensureClient().send<TResult>(method, params, sessionId);
  }

  async send<TResult = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<TResult> {
    return this.ensureClient().send<TResult>(method, params);
  }

  onTargetAttached(handler: (event: AttachedTargetEvent) => void): () => void {
    return this.ensureClient().on("Target.attachedToTarget", (params) =>
      handler(params as AttachedTargetEvent),
    );
  }

  async waitIfCaptchaSolving(timeoutMs?: number): Promise<CaptchaWaitResult | null> {
    return this.captchaWatchdog.waitIfSolving(timeoutMs);
  }

  async newPage(): Promise<Page> {
    const client = this.ensureClient();
    const { targetId } = await client.send<{ targetId: string }>("Target.createTarget", {
      url: "about:blank",
    });
    await this.getOrAttachSessionId(targetId);
    const page = this.pageCache.get(targetId) ?? new Page(this, targetId);
    this.pageCache.set(targetId, page);
    return page;
  }

  async closePage(targetId: string): Promise<void> {
    const sessionId = this.targetToSession.get(targetId);
    await this.send("Target.closeTarget", { targetId });
    this.targetToSession.delete(targetId);
    if (sessionId) this.sessionToTarget.delete(sessionId);
    this.targetEnablePromises.delete(targetId);
    this.pageCache.delete(targetId);
  }

  getPage(targetId: string): Page {
    const existing = this.pageCache.get(targetId);
    if (existing) return existing;
    const created = new Page(this, targetId);
    this.pageCache.set(targetId, created);
    return created;
  }

  async listPages(): Promise<Page[]> {
    const client = this.ensureClient();
    const response = await client.send<{ targetInfos?: Array<{ targetId: string; type: string }> }>(
      "Target.getTargets",
    );
    const targetInfos = response.targetInfos ?? [];
    return targetInfos
      .filter((target) => target.type === "page")
      .map((target) => this.getPage(target.targetId));
  }

  async listPageTargetIds(): Promise<string[]> {
    const pages = await this.listPages();
    return pages.map((page) => page.targetId);
  }

  /**
   * Resolve with the targetId of the next page target attached with
   * `openerId === openerTargetId`, or `null` if none attaches within
   * `timeoutMs`. The opener filter prevents unrelated background tab
   * attachments (downloads, prior navigation popups) from being mistaken
   * for the caller's click outcome. Subscribe before triggering the
   * spawning action so `Target.attachedToTarget` cannot race.
   */
  waitForNewPageTarget(timeoutMs: number, openerTargetId?: string): Promise<string | null> {
    return new Promise((resolve) => {
      let settled = false;
      const finish = (targetId: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsubscribe();
        resolve(targetId);
      };
      const unsubscribe = this.eventBus.on((event) => {
        if (
          event.type !== "browser_event" ||
          event.name !== "target_attached" ||
          typeof event.targetId !== "string"
        ) {
          return;
        }
        if (openerTargetId !== undefined) {
          const data = event.data as { openerId?: string } | undefined;
          if (data?.openerId !== openerTargetId) return;
        }
        finish(event.targetId);
      });
      const timer = setTimeout(() => finish(null), timeoutMs);
    });
  }

  async close(): Promise<void> {
    await this.dispose("stopped", (browser) => browser.close());
  }

  async kill(): Promise<void> {
    await this.dispose("stopped", (browser) => browser.kill());
  }

  private async dispose(
    finalState: BrowserSessionState,
    closeBrowser: (browser: LaunchedBrowser) => Promise<void>,
  ): Promise<void> {
    this.intentionalStop = true;
    this.setState(finalState);

    if (this.profile.storageStatePath && this.profile.saveStorageStateOnClose && this.client) {
      try {
        await saveStorageState(
          this.client,
          this.profile,
          this.eventBus,
          this.loadedStorageState?.origins ?? [],
          () => this.listPages(),
        );
      } catch (error) {
        void this.eventBus.emit({
          type: "browser_event",
          name: "storage_state_failed",
          data: {
            path: this.profile.storageStatePath,
            operation: "save",
            error: error instanceof Error ? error.message : String(error),
          },
        });
        void this.eventBus.emit({
          type: "browser_error",
          message: "Failed to save storage state",
          error,
        });
        throw error;
      }
    }

    this.client?.close();
    this.client = null;

    if (this.browser) {
      await closeBrowser(this.browser);
      this.browser = null;
    }

    this.captchaWatchdog.detach();
    this.targetToSession.clear();
    this.sessionToTarget.clear();
    this.targetEnablePromises.clear();
    this.pageCache.clear();
    this.downloads.clear();
    this.loadedStorageState = null;
    this.stateListeners.clear();
  }
}

function createProfile(options: BrowserSessionOptions): BrowserProfile {
  const launch = options.launch;
  return new BrowserProfile({
    ...options.profile,
    ...(launch
      ? {
          executablePath: launch.executablePath,
          channel: launch.channel,
          headless: launch.headless,
          userDataDir: launch.userDataDir,
          proxyServer: launch.proxyServer,
          proxyBypass: launch.proxyBypass,
          userAgent: launch.userAgent,
          acceptLanguage: launch.acceptLanguage,
          locale: launch.locale,
          timezoneId: launch.timezoneId,
          extensionPaths: launch.extensionPaths,
          remoteDebuggingPort: launch.port,
          docker: launch.docker,
          disableSecurity: launch.disableSecurity,
          extraArgs: launch.extraArgs,
          maxLaunchRetries: launch.maxRetries,
          autoInstallBrowser: launch.autoInstallBrowser,
          downloadsDir: launch.downloadsDir,
          permissionGrants: launch.permissionGrants ?? options.profile?.permissionGrants,
          storageStatePath: launch.storageStatePath ?? options.profile?.storageStatePath,
          saveStorageStateOnClose:
            launch.saveStorageStateOnClose ?? options.profile?.saveStorageStateOnClose,
          autoConsent: launch.autoConsent ?? options.profile?.autoConsent,
        }
      : {}),
    cdpUrl: options.cdpUrl ?? options.profile?.cdpUrl,
  });
}
