import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { CDPClient } from "../cdp/client";
import { launchBrowserFromProfile, type LaunchOptions, type LaunchedBrowser } from "../cdp/launch";
import { BrowserProfile, type BrowserProfileInit } from "./profile";
import { CaptchaWatchdog, type CaptchaWaitResult } from "./watchdogs/captcha";
import { BrowserEventBus } from "./events";
import {
  buildLocalStorageRestoreScript,
  cookieToParam,
  createEmptyStorageState,
  readStorageStateFile,
  writeStorageStateFile,
  type BrowserOriginStorageState,
  type BrowserStorageState,
} from "./storage-state";

export type BrowserSessionState =
  | "idle"
  | "launching"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "stopped";

export interface BrowserSessionOptions {
  profile?: BrowserProfileInit;
  launch?: LaunchOptions;
  cdpUrl?: string;
}

interface AttachedTargetEvent {
  sessionId: string;
  targetInfo: { targetId: string; type: string; url: string; openerId?: string };
}

interface DetachedTargetEvent {
  sessionId: string;
  targetId: string;
}

interface JavascriptDialogOpeningEvent {
  type?: "alert" | "confirm" | "prompt" | "beforeunload";
  message?: string;
  url?: string;
  hasBrowserHandler?: boolean;
  defaultPrompt?: string;
}

interface DownloadWillBeginEvent {
  frameId?: string;
  guid: string;
  url: string;
  suggestedFilename: string;
}

interface DownloadProgressEvent {
  guid: string;
  totalBytes?: number;
  receivedBytes?: number;
  state: "inProgress" | "completed" | "canceled";
  filePath?: string;
}

interface DownloadInfo {
  guid: string;
  url: string;
  suggestedFilename: string;
  startedAt: string;
  targetPath?: string;
}

export interface PendingNetworkRequest {
  url: string;
  method: string;
  loadingDurationMs: number;
  resourceType: string;
}

export interface SearchPageParams {
  pattern: string;
  regex?: boolean;
  caseSensitive?: boolean;
  contextChars?: number;
  cssScope?: string;
  maxResults?: number;
}

export interface FindElementsParams {
  selector: string;
  attributes?: string[];
  maxResults?: number;
  includeText?: boolean;
}

export type NavigationHealthStatus = "loaded" | "timeout" | "empty" | "cdp_error";

export interface NavigationHealthResult {
  ok: boolean;
  status: NavigationHealthStatus;
  url: string;
  finalUrl?: string;
  readyState?: string;
  durationMs: number;
  warning?: string;
}

export interface ExtractContentParams {
  query: string;
  extractLinks?: boolean;
  extractImages?: boolean;
  startFromChar?: number;
  maxChars?: number;
  /** Canonical identifiers already collected; deduped against new links. */
  alreadyCollected?: string[];
}

export interface ExtractContentResult {
  url: string;
  query: string;
  content: string;
  stats: {
    totalChars: number;
    startFromChar: number;
    returnedChars: number;
    truncated: boolean;
    nextStartChar: number | null;
    linksCount: number;
    imagesCount: number;
  };
}

interface RuntimeExceptionDetails {
  text?: string;
  lineNumber?: number;
  columnNumber?: number;
  exception?: { description?: string; value?: unknown };
}

function formatRuntimeException(details: RuntimeExceptionDetails): string {
  const line = typeof details.lineNumber === "number" ? ` at ${details.lineNumber + 1}` : "";
  const column = typeof details.columnNumber === "number" ? `:${details.columnNumber + 1}` : "";
  const description =
    details.exception?.description ??
    (typeof details.exception?.value === "string" ? details.exception.value : undefined);
  return `${details.text ?? "unknown error"}${line}${column}${description ? ` — ${description}` : ""}`;
}

function navigationFailureStatus(message: string): NavigationHealthStatus {
  return message.includes("Navigation timeout") ? "timeout" : "cdp_error";
}

function createJavaScriptDialogWatchdogData(event: JavascriptDialogOpeningEvent): {
  dialogType: "alert" | "confirm" | "prompt" | "beforeunload";
  accepted: boolean;
  policy: "accept_non_prompt" | "dismiss_prompt";
  event: JavascriptDialogOpeningEvent;
} {
  const dialogType = event.type ?? "alert";
  const accepted = dialogType !== "prompt";
  return {
    dialogType,
    accepted,
    policy: accepted ? "accept_non_prompt" : "dismiss_prompt",
    event,
  };
}

/**
 * Resolves a safe download path inside `downloadsDir`.
 * `basename` strips any directory components from `suggestedFilename`, so
 * subdirectories are flattened to the root of `downloadsDir`.
 */
function safeDownloadPath(downloadsDir: string, suggestedFilename: string): string {
  const targetPath = resolve(downloadsDir, basename(suggestedFilename));
  const relativePath = relative(resolve(downloadsDir), targetPath);
  if (relativePath.startsWith("..") || relativePath === "") {
    return resolve(downloadsDir, "download");
  }
  return targetPath;
}

const AD_DOMAINS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googletagmanager.com",
  "facebook.net",
  "analytics",
  "ads",
  "tracking",
  "pixel",
  "hotjar.com",
  "clarity.ms",
  "mixpanel.com",
  "segment.com",
  "demdex.net",
  "omtrdc.net",
  "adobedtm.com",
  "ensighten.com",
  "newrelic.com",
  "nr-data.net",
  "google-analytics.com",
  "connect.facebook.net",
  "platform.twitter.com",
  "platform.linkedin.com",
  ".cloudfront.net/image/",
  ".akamaized.net/image/",
  "/tracker/",
  "/collector/",
  "/beacon/",
  "/telemetry/",
  "/log/",
  "/events/",
  "/eventBatch",
  "/track.",
  "/metrics/",
];

const STEALTH_INIT_SCRIPT = `
(() => {
  const patch = (obj, key, value) => {
    try {
      Object.defineProperty(obj, key, { get: () => value, configurable: true });
    } catch {}
  };

  patch(Navigator.prototype, "webdriver", undefined);
  patch(Navigator.prototype, "language", "en-US");
  patch(Navigator.prototype, "languages", ["en-US", "en"]);
  patch(Navigator.prototype, "plugins", [1, 2, 3, 4, 5]);
  patch(Navigator.prototype, "hardwareConcurrency", 8);

  if (!window.chrome) {
    // Minimal chrome object expected by many bot checks.
    window.chrome = { runtime: {} };
  } else if (!window.chrome.runtime) {
    window.chrome.runtime = {};
  }
})();
`;

export class BrowserSession {
  readonly profile: BrowserProfile;
  readonly eventBus = new BrowserEventBus();

  private browser: LaunchedBrowser | null = null;
  private client: CDPClient | null = null;
  private state: BrowserSessionState = "idle";
  private intentionalStop = false;
  private reconnecting = false;

  private targetToSession = new Map<string, string>();
  private sessionToTarget = new Map<string, string>();
  private targetEnablePromises = new Map<string, Promise<void>>();
  private pageCache = new Map<string, Page>();
  private stateListeners = new Set<(state: BrowserSessionState) => void>();
  private downloads = new Map<string, DownloadInfo>();
  private loadedStorageState: BrowserStorageState | null = null;

  private captchaWatchdog = new CaptchaWatchdog();

  constructor(options: BrowserSessionOptions = {}) {
    const launch = options.launch;
    this.profile = new BrowserProfile({
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
          }
        : {}),
      cdpUrl: options.cdpUrl ?? options.profile?.cdpUrl,
    });
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

  private setState(state: BrowserSessionState): void {
    this.state = state;
    void this.eventBus.emit({ type: "browser_event", name: "state", data: { state } });
    for (const listener of this.stateListeners) {
      listener(state);
    }
  }

  private ensureClient(): CDPClient {
    if (!this.client) {
      throw new Error("Browser session is not connected");
    }
    return this.client;
  }

  private getSocketUrl(): string {
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

  private async connectToEndpoint(wsUrl: string): Promise<void> {
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
        data: { reason: "websocket_closed", reconnectEnabled: this.profile.reconnectOnDisconnect },
      });
      void this.reconnectIfNeeded();
    });

    this.client = client;

    if (this.profile.captchaSolver) {
      this.captchaWatchdog.attach(client);
    }

    await this.loadStorageState(client);
    await this.configurePermissions(client);
    await this.configureDownloads(client);

    client.on("Browser.downloadWillBegin", (params) => {
      const event = params as DownloadWillBeginEvent;
      const info: DownloadInfo = {
        guid: event.guid,
        url: event.url,
        suggestedFilename: event.suggestedFilename,
        startedAt: new Date().toISOString(),
        ...(this.profile.downloadsDir
          ? { targetPath: safeDownloadPath(this.profile.downloadsDir, event.suggestedFilename) }
          : {}),
      };
      this.downloads.set(event.guid, info);
      void this.eventBus.emit({
        type: "browser_event",
        name: "download_started",
        data: info,
      });
    });

    client.on("Browser.downloadProgress", (params) => {
      const event = params as DownloadProgressEvent;
      const info = this.downloads.get(event.guid);
      const data = {
        guid: event.guid,
        state: event.state,
        totalBytes: event.totalBytes,
        receivedBytes: event.receivedBytes,
        url: info?.url,
        suggestedFilename: info?.suggestedFilename,
        path: event.filePath ?? info?.targetPath,
      };

      if (event.state === "inProgress") {
        void this.eventBus.emit({ type: "browser_event", name: "download_progress", data });
        return;
      }

      this.downloads.delete(event.guid);
      void this.eventBus.emit({
        type: "browser_event",
        name: event.state === "completed" ? "download_completed" : "download_failed",
        data,
      });
    });

    client.on("Target.attachedToTarget", (params) => {
      const event = params as AttachedTargetEvent;
      if (event.targetInfo.type !== "page") return;
      this.targetToSession.set(event.targetInfo.targetId, event.sessionId);
      this.sessionToTarget.set(event.sessionId, event.targetInfo.targetId);
      const enablePromise = this.enableDomains(event.sessionId)
        .then(() => {
          void this.eventBus.emit({
            type: "browser_event",
            name: "target_attached",
            targetId: event.targetInfo.targetId,
            data: event.targetInfo,
          });
        })
        .catch((error) => {
          this.targetToSession.delete(event.targetInfo.targetId);
          this.sessionToTarget.delete(event.sessionId);
          if (this.intentionalStop) return;
          void this.eventBus.emit({
            type: "browser_error",
            message: "Failed to enable page domains",
            targetId: event.targetInfo.targetId,
            error,
          });
        })
        .finally(() => {
          this.targetEnablePromises.delete(event.targetInfo.targetId);
        });
      this.targetEnablePromises.set(event.targetInfo.targetId, enablePromise);
    });

    client.on("Target.detachedFromTarget", (params) => {
      const event = params as DetachedTargetEvent;
      this.sessionToTarget.delete(event.sessionId);
      this.targetToSession.delete(event.targetId);
      this.targetEnablePromises.delete(event.targetId);
      void this.eventBus.emit({
        type: "browser_event",
        name: "target_detached",
        targetId: event.targetId,
        data: event,
      });
    });

    client.on("Page.javascriptDialogOpening", async (params, sessionId) => {
      if (!sessionId) return;
      const event = (params ?? {}) as JavascriptDialogOpeningEvent;
      const targetId = this.sessionToTarget.get(sessionId);
      const data = createJavaScriptDialogWatchdogData(event);
      try {
        await client.send(
          "Page.handleJavaScriptDialog",
          {
            accept: data.accepted,
          },
          sessionId,
        );
      } catch {
        // ignore dialog handling errors
      }
      void this.eventBus.emit({
        type: "browser_event",
        name: "javascript_dialog",
        targetId,
        data,
      });
    });

    await client.send("Target.setDiscoverTargets", { discover: true });
    await client.send("Target.setAutoAttach", {
      autoAttach: true,
      flatten: true,
      waitForDebuggerOnStart: false,
    });

    await this.attachExistingPages();
  }

  private async configureDownloads(client: CDPClient): Promise<void> {
    if (!this.profile.downloadsDir) return;
    mkdirSync(this.profile.downloadsDir, { recursive: true });
    try {
      await client.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath: this.profile.downloadsDir,
        eventsEnabled: true,
      });
      void this.eventBus.emit({
        type: "browser_event",
        name: "download_watchdog_enabled",
        data: { downloadsDir: this.profile.downloadsDir },
      });
    } catch (error) {
      void this.eventBus.emit({
        type: "browser_error",
        message: "Failed to enable download watchdog",
        error,
      });
    }
  }

  private async loadStorageState(client: CDPClient): Promise<void> {
    if (!this.profile.storageStatePath) return;
    try {
      const state = await readStorageStateFile(this.profile.storageStatePath);
      this.loadedStorageState = state;
      if (!state) {
        void this.eventBus.emit({
          type: "browser_event",
          name: "storage_state_missing",
          data: {
            path: this.profile.storageStatePath,
          },
        });
        return;
      }

      if (state.cookies.length > 0) {
        await client.send("Storage.setCookies", {
          cookies: state.cookies.map(cookieToParam),
        });
      }

      void this.eventBus.emit({
        type: "browser_event",
        name: "storage_state_loaded",
        data: {
          path: this.profile.storageStatePath,
          cookieCount: state.cookies.length,
          originCount: state.origins.length,
          origins: state.origins.map((origin) => origin.origin),
        },
      });
    } catch (error) {
      void this.eventBus.emit({
        type: "browser_event",
        name: "storage_state_failed",
        data: {
          path: this.profile.storageStatePath,
          operation: "load",
          error: error instanceof Error ? error.message : String(error),
        },
      });
      void this.eventBus.emit({
        type: "browser_error",
        message: "Failed to load storage state",
        error,
      });
    }
  }

  private async configurePermissions(client: CDPClient): Promise<void> {
    for (const grant of this.profile.permissionGrants) {
      if (grant.permissions.length === 0) continue;

      const params: Record<string, unknown> = { permissions: grant.permissions };
      if (grant.origin) params.origin = grant.origin;

      try {
        await client.send("Browser.grantPermissions", params);
        void this.eventBus.emit({
          type: "browser_event",
          name: "permissions_watchdog_enabled",
          data: {
            permissions: grant.permissions,
            origin: grant.origin,
          },
        });
      } catch (error) {
        void this.eventBus.emit({
          type: "browser_event",
          name: "permissions_watchdog_failed",
          data: {
            permissions: grant.permissions,
            origin: grant.origin,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        void this.eventBus.emit({
          type: "browser_error",
          message: "Failed to configure permission grants",
          error,
        });
      }
    }
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

  private async reconnectIfNeeded(): Promise<void> {
    if (this.intentionalStop || this.reconnecting) {
      return;
    }

    if (!this.profile.reconnectOnDisconnect) {
      void this.eventBus.emit({
        type: "browser_event",
        name: "cdp_reconnect_failed",
        data: { reason: "reconnect_disabled", maxAttempts: this.profile.reconnectMaxAttempts },
      });
      return;
    }

    this.reconnecting = true;
    this.setState("reconnecting");
    void this.eventBus.emit({
      type: "browser_event",
      name: "cdp_reconnect_started",
      data: {
        maxAttempts: this.profile.reconnectMaxAttempts,
        managedLocal: this.profile.isManagedLocal(),
      },
    });

    try {
      let attempt = 0;
      while (attempt < this.profile.reconnectMaxAttempts && !this.intentionalStop) {
        attempt += 1;
        void this.eventBus.emit({
          type: "browser_event",
          name: "cdp_reconnect_attempt",
          data: {
            attempt,
            maxAttempts: this.profile.reconnectMaxAttempts,
            managedLocal: this.profile.isManagedLocal(),
          },
        });

        if (this.profile.isManagedLocal()) {
          const browserStillAlive = this.browser?.process.exitCode === null;
          if (!browserStillAlive) {
            this.browser = await launchBrowserFromProfile(this.profile);
          }
        }

        try {
          await this.connectToEndpoint(this.getSocketUrl());
          this.setState("connected");
          void this.eventBus.emit({
            type: "browser_event",
            name: "cdp_reconnected",
            data: { attempt, maxAttempts: this.profile.reconnectMaxAttempts },
          });
          return;
        } catch (error) {
          const backoff = Math.min(
            this.profile.reconnectMaxDelayMs,
            this.profile.reconnectBaseDelayMs * 2 ** (attempt - 1),
          );
          void this.eventBus.emit({
            type: "browser_event",
            name: "cdp_reconnect_attempt_failed",
            data: {
              attempt,
              maxAttempts: this.profile.reconnectMaxAttempts,
              backoffMs: backoff,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          await delay(backoff);
        }
      }

      this.setState("disconnected");
      void this.eventBus.emit({
        type: "browser_event",
        name: "cdp_reconnect_failed",
        data: { reason: "max_attempts_exhausted", maxAttempts: this.profile.reconnectMaxAttempts },
      });
      if (this.browser) {
        await this.browser.close().catch(() => {});
        this.browser = null;
      }
    } finally {
      this.reconnecting = false;
    }
  }

  private async enableDomains(sessionId: string): Promise<void> {
    const client = this.ensureClient();
    await client.send("Page.enable", {}, sessionId);
    const storageScript = buildLocalStorageRestoreScript(this.loadedStorageState?.origins ?? []);
    if (storageScript) {
      await client.send(
        "Page.addScriptToEvaluateOnNewDocument",
        { source: storageScript },
        sessionId,
      );
    }
    await client.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: STEALTH_INIT_SCRIPT },
      sessionId,
    );
    if (this.profile.userAgent || this.profile.acceptLanguage) {
      await client
        .send(
          "Emulation.setUserAgentOverride",
          {
            userAgent:
              this.profile.userAgent ??
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            acceptLanguage: this.profile.acceptLanguage,
            platform: "MacIntel",
          },
          sessionId,
        )
        .catch(() => {
          // best effort
        });
    }
    if (this.profile.locale) {
      await client
        .send("Emulation.setLocaleOverride", { locale: this.profile.locale }, sessionId)
        .catch(() => {
          // best effort
        });
    }
    if (this.profile.timezoneId) {
      await client
        .send("Emulation.setTimezoneOverride", { timezoneId: this.profile.timezoneId }, sessionId)
        .catch(() => {
          // best effort
        });
    }
    await client.send("Runtime.enable", {}, sessionId);
    await client.send("DOM.enable", {}, sessionId);
  }

  private async attachTarget(targetId: string): Promise<string> {
    const client = this.ensureClient();
    const { sessionId } = await client.send<{ sessionId: string }>("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const enablePromise = this.enableDomains(sessionId).finally(() => {
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
        await this.saveStorageState();
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

  private async saveStorageState(): Promise<void> {
    if (!this.profile.storageStatePath) return;
    const client = this.ensureClient();
    const cookiesResponse = await client.send<{ cookies?: BrowserStorageState["cookies"] }>(
      "Storage.getCookies",
    );
    const collected = await this.collectOpenOriginStorage();
    const mergedOrigins = new Map<string, BrowserOriginStorageState>();
    for (const origin of this.loadedStorageState?.origins ?? []) {
      mergedOrigins.set(origin.origin, origin);
    }
    for (const origin of collected) {
      mergedOrigins.set(origin.origin, origin);
    }
    const state: BrowserStorageState = {
      ...createEmptyStorageState(),
      cookies: cookiesResponse.cookies ?? [],
      origins: Array.from(mergedOrigins.values()),
    };
    await writeStorageStateFile(this.profile.storageStatePath, state);
    void this.eventBus.emit({
      type: "browser_event",
      name: "storage_state_saved",
      data: {
        path: this.profile.storageStatePath,
        cookieCount: state.cookies.length,
        originCount: state.origins.length,
        origins: state.origins.map((origin) => origin.origin),
      },
    });
  }

  private async collectOpenOriginStorage(): Promise<BrowserOriginStorageState[]> {
    const pages = await this.listPages().catch(() => []);
    const byOrigin = new Map<string, BrowserOriginStorageState>();
    for (const page of pages) {
      const origin = await page.origin().catch(() => undefined);
      if (!origin || origin === "null" || byOrigin.has(origin)) continue;
      const localStorage = await page.readLocalStorage().catch(() => undefined);
      if (!localStorage) continue;
      byOrigin.set(origin, { origin, localStorage });
    }
    return Array.from(byOrigin.values());
  }
}

export class Page {
  private session: BrowserSession;
  readonly targetId: string;

  constructor(session: BrowserSession, targetId: string) {
    this.session = session;
    this.targetId = targetId;
  }

  async goto(url: string, waitUntil: "load" | "domcontentloaded" = "load"): Promise<void> {
    const navigation = await this.session.sendToTarget<{ errorText?: string }>(
      this.targetId,
      "Page.navigate",
      { url },
    );
    if (navigation.errorText) {
      throw new Error(`Navigation failed for ${url}: ${navigation.errorText}`);
    }

    const startedAt = Date.now();
    const timeoutMs = 30_000;
    while (Date.now() - startedAt < timeoutMs) {
      const readyState = await this.evaluate<string>("document.readyState").catch(() => "loading");
      if (waitUntil === "domcontentloaded") {
        if (readyState === "interactive" || readyState === "complete") return;
      } else if (readyState === "complete") {
        return;
      }
      await delay(100);
    }

    throw new Error(`Navigation timeout after ${timeoutMs}ms for ${url}`);
  }

  async goBack(): Promise<boolean> {
    const history = await this.session.sendToTarget<{
      currentIndex: number;
      entries: Array<{ id: number }>;
    }>(this.targetId, "Page.getNavigationHistory");

    if (history.currentIndex <= 0) {
      return false;
    }

    const entry = history.entries[history.currentIndex - 1];
    if (!entry) return false;

    await this.session.sendToTarget(this.targetId, "Page.navigateToHistoryEntry", {
      entryId: entry.id,
    });
    await this.waitForStablePage(5_000).catch(() => {
      // best-effort stabilization
    });
    return true;
  }

  async goForward(): Promise<boolean> {
    const history = await this.session.sendToTarget<{
      currentIndex: number;
      entries: Array<{ id: number }>;
    }>(this.targetId, "Page.getNavigationHistory");

    const nextIndex = history.currentIndex + 1;
    const entry = history.entries[nextIndex];
    if (!entry) {
      return false;
    }

    await this.session.sendToTarget(this.targetId, "Page.navigateToHistoryEntry", {
      entryId: entry.id,
    });
    await this.waitForStablePage(5_000).catch(() => {
      // best-effort stabilization
    });
    return true;
  }

  async refresh(): Promise<void> {
    await this.session.sendToTarget(this.targetId, "Page.reload", {
      ignoreCache: false,
    });
    await this.waitForStablePage(8_000).catch(() => {
      // best-effort stabilization
    });
  }

  private async appearsEmptyPage(): Promise<boolean> {
    return this.evaluate<boolean>(`(() => {
      const body = document.body;
      if (!body) return true;

      const text = (body.innerText || "").trim();
      const hasText = text.length > 0;

      const interactive = body.querySelectorAll(
        'a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]'
      ).length;

      const meaningfulMedia = body.querySelectorAll('img,video,canvas,svg,iframe,embed,object').length;

      return !hasText && interactive === 0 && meaningfulMedia === 0;
    })()`);
  }

  async navigateWithHealthCheck(url: string): Promise<NavigationHealthResult> {
    const startedAt = Date.now();
    try {
      await this.goto(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.finishNavigationHealth({
        ok: false,
        status: navigationFailureStatus(message),
        url,
        startedAt,
        warning: message,
      });
    }

    const isHttp = url.startsWith("http://") || url.startsWith("https://");
    if (!isHttp) {
      return this.finishNavigationHealth({
        ok: true,
        status: "loaded",
        url,
        startedAt,
      });
    }

    let empty = await this.appearsEmptyPage().catch(() => false);
    if (!empty) {
      return this.finishNavigationHealth({
        ok: true,
        status: "loaded",
        url,
        startedAt,
      });
    }

    await delay(3_000);
    empty = await this.appearsEmptyPage().catch(() => false);
    if (!empty) {
      return this.finishNavigationHealth({
        ok: true,
        status: "loaded",
        url,
        startedAt,
      });
    }

    try {
      await this.goto(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.finishNavigationHealth({
        ok: false,
        status: navigationFailureStatus(message),
        url,
        startedAt,
        warning: message,
      });
    }
    await delay(5_000);
    empty = await this.appearsEmptyPage().catch(() => false);
    if (empty) {
      return this.finishNavigationHealth({
        ok: false,
        status: "empty",
        url,
        startedAt,
        warning:
          "Page loaded but returned empty content. It may require anti-bot measures, failed JavaScript rendering, or have connection/proxy issues.",
      });
    }

    return this.finishNavigationHealth({
      ok: true,
      status: "loaded",
      url,
      startedAt,
    });
  }

  private async finishNavigationHealth(input: {
    ok: boolean;
    status: NavigationHealthStatus;
    url: string;
    startedAt: number;
    warning?: string;
  }): Promise<NavigationHealthResult> {
    const result: NavigationHealthResult = {
      ok: input.ok,
      status: input.status,
      url: input.url,
      finalUrl: await this.currentUrl().catch(() => undefined),
      readyState: await this.evaluate<string>("document.readyState").catch(() => undefined),
      durationMs: Date.now() - input.startedAt,
      ...(input.warning ? { warning: input.warning } : {}),
    };
    await this.emitNavigationWatchdog(result);
    return result;
  }

  private async emitNavigationWatchdog(result: NavigationHealthResult): Promise<void> {
    await this.session.eventBus.emit({
      type: "browser_event",
      name: "navigation_watchdog",
      targetId: this.targetId,
      data: result,
    });
  }

  async sendCDP<TResult = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<TResult> {
    return this.session.sendToTarget<TResult>(this.targetId, method, params);
  }

  async evaluate<TResult = unknown>(expression: string): Promise<TResult> {
    const result = await this.session.sendToTarget<{
      result: { value?: TResult };
      exceptionDetails?: RuntimeExceptionDetails;
    }>(this.targetId, "Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
      throw new Error(
        `Runtime evaluation failed: ${formatRuntimeException(result.exceptionDetails)}`,
      );
    }

    return result.result.value as TResult;
  }

  async origin(): Promise<string> {
    return this.evaluate<string>("location.origin");
  }

  async readLocalStorage(): Promise<Record<string, string>> {
    return this.evaluate<Record<string, string>>(`(() => {
      const values = {};
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (key == null) continue;
        values[key] = localStorage.getItem(key) ?? "";
      }
      return values;
    })()`);
  }

  async evaluateHandle(expression: string): Promise<string> {
    const result = await this.session.sendToTarget<{
      result: { objectId?: string };
      exceptionDetails?: RuntimeExceptionDetails;
    }>(this.targetId, "Runtime.evaluate", {
      expression,
      returnByValue: false,
      awaitPromise: true,
    });

    if (result.exceptionDetails) {
      throw new Error(
        `Runtime evaluation handle failed: ${formatRuntimeException(result.exceptionDetails)}`,
      );
    }

    if (!result.result.objectId) {
      throw new Error("Runtime evaluation did not return an object handle");
    }

    return result.result.objectId;
  }

  private async resolveBackendNode(backendNodeId: number): Promise<string | null> {
    try {
      const res = await this.session.sendToTarget<{ object?: { objectId?: string } }>(
        this.targetId,
        "DOM.resolveNode",
        { backendNodeId },
      );
      return res.object?.objectId ?? null;
    } catch {
      return null;
    }
  }

  private async releaseObject(objectId: string): Promise<void> {
    await this.session
      .sendToTarget(this.targetId, "Runtime.releaseObject", { objectId })
      .catch(() => {});
  }

  /**
   * Call a function on a node identified by backendNodeId. Returns
   * `{ ok: false, reason: "index_stale" }` when the node no longer exists.
   */
  async callOnBackendNode<TResult = unknown>(
    backendNodeId: number,
    functionDeclaration: string,
    args: unknown[] = [],
  ): Promise<
    | { ok: true; value: TResult }
    | { ok: false; reason: "index_stale" }
    | { ok: false; reason: "exception"; error: string }
  > {
    const objectId = await this.resolveBackendNode(backendNodeId);
    if (!objectId) return { ok: false, reason: "index_stale" };
    try {
      const res = await this.session.sendToTarget<{
        result: { value?: TResult };
        exceptionDetails?: RuntimeExceptionDetails;
      }>(this.targetId, "Runtime.callFunctionOn", {
        functionDeclaration,
        objectId,
        returnByValue: true,
        awaitPromise: true,
        arguments: args.map((value) => ({ value })),
      });
      if (res.exceptionDetails) {
        return {
          ok: false,
          reason: "exception",
          error: formatRuntimeException(res.exceptionDetails),
        };
      }
      return { ok: true, value: res.result.value as TResult };
    } finally {
      await this.releaseObject(objectId);
    }
  }

  async clickByBackendNodeId(
    backendNodeId: number,
  ): Promise<{ ok: true } | { ok: false; reason: "index_stale" }> {
    const result = await this.callOnBackendNode<void>(
      backendNodeId,
      `function() {
        this.scrollIntoView({ block: "center", inline: "center" });
        if (typeof this.click === "function") { this.click(); return; }
        this.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      }`,
    );
    if (result.ok) return { ok: true };
    if (result.reason === "index_stale") return { ok: false, reason: "index_stale" };
    return { ok: false, reason: "index_stale" };
  }

  async clickAtCoordinates(x: number, y: number): Promise<void> {
    await this.session.sendToTarget(this.targetId, "Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x,
      y,
      button: "none",
      clickCount: 0,
    });
    await this.session.sendToTarget(this.targetId, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
    await this.session.sendToTarget(this.targetId, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    });
  }

  async typeByBackendNodeId(
    backendNodeId: number,
    text: string,
    submit = false,
    mode: "replace" | "append" = "replace",
  ): Promise<
    | { ok: true }
    | { ok: false; reason: "index_stale" }
    | { ok: false; reason: "not_typable" }
    | { ok: false; reason: "value_mismatch" }
  > {
    type TypeJsResult =
      | "not_typable"
      | { kind: "ok" }
      | { kind: "value_mismatch"; expected: string; actual: string };
    const result = await this.callOnBackendNode<TypeJsResult>(
      backendNodeId,
      `function(text, submit, mode) {
        const tag = this.tagName;
        const isInputLike = tag === "INPUT" || tag === "TEXTAREA";
        if (!isInputLike && !this.isContentEditable) return "not_typable";
        this.focus();
        const setValue = (v) => {
          if (this.isContentEditable) { this.textContent = v; return; }
          const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const desc = Object.getOwnPropertyDescriptor(proto, "value");
          const setter = desc && desc.set;
          if (setter) setter.call(this, v); else this.value = v;
        };
        if (mode === "replace") {
          try { if (typeof this.select === "function") this.select(); } catch (_) {}
          setValue("");
          this.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
        }
        const prefix = mode === "append"
          ? (this.isContentEditable ? (this.textContent || "") : (this.value || ""))
          : "";
        const expected = prefix + text;
        setValue(expected);
        this.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
        if (submit) {
          const form = this.form;
          if (form) {
            if (form.requestSubmit) form.requestSubmit(); else form.submit();
          } else {
            this.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
            this.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
          }
        }
        const actual = this.isContentEditable ? (this.textContent || "") : (this.value || "");
        if (actual !== expected) return { kind: "value_mismatch", expected: expected, actual: actual };
        return { kind: "ok" };
      }`,
      [text, submit, mode],
    );
    if (!result.ok) {
      if (result.reason === "index_stale") return { ok: false, reason: "index_stale" };
      return { ok: false, reason: "not_typable" };
    }
    if (result.value === "not_typable") return { ok: false, reason: "not_typable" };
    if (typeof result.value === "object" && result.value.kind === "value_mismatch") {
      // Discard expected/actual at this boundary — they may contain a secret.
      return { ok: false, reason: "value_mismatch" };
    }
    return { ok: true };
  }

  async selectOptionByBackendNodeId(
    backendNodeId: number,
    valueOrLabel: string,
  ): Promise<
    { ok: true } | { ok: false; reason: "index_stale" } | { ok: false; reason: "no_match" }
  > {
    const result = await this.callOnBackendNode<"ok" | "no_match" | "wrong_tag">(
      backendNodeId,
      `function(target) {
        if (this.tagName !== "SELECT") return "wrong_tag";
        const options = Array.from(this.options || []);
        const byValue = options.find((opt) => opt.value === target);
        const byLabel = options.find((opt) => (opt.label || opt.textContent || "").trim() === target);
        const match = byValue || byLabel;
        if (!match) return "no_match";
        this.value = match.value;
        this.dispatchEvent(new Event("input", { bubbles: true }));
        this.dispatchEvent(new Event("change", { bubbles: true }));
        return "ok";
      }`,
      [valueOrLabel],
    );
    if (!result.ok) return { ok: false, reason: "index_stale" };
    if (result.value !== "ok") return { ok: false, reason: "no_match" };
    return { ok: true };
  }

  async sendKeys(keys: string): Promise<void> {
    const tokens = keys
      .split("+")
      .map((token) => token.trim())
      .filter((token) => token.length > 0);

    if (tokens.length === 0) {
      throw new Error("sendKeys requires non-empty key string");
    }

    const modifiers = new Set<string>();
    for (const token of tokens.slice(0, -1)) {
      const normalized = token.toLowerCase();
      if (normalized === "control" || normalized === "ctrl") modifiers.add("Control");
      if (normalized === "shift") modifiers.add("Shift");
      if (normalized === "alt") modifiers.add("Alt");
      if (normalized === "meta" || normalized === "command") modifiers.add("Meta");
    }

    const modifierMask =
      (modifiers.has("Alt") ? 1 : 0) |
      (modifiers.has("Control") ? 2 : 0) |
      (modifiers.has("Meta") ? 4 : 0) |
      (modifiers.has("Shift") ? 8 : 0);

    const mainKey = tokens[tokens.length - 1] as string;

    for (const modifier of modifiers) {
      await this.session.sendToTarget(this.targetId, "Input.dispatchKeyEvent", {
        type: "keyDown",
        key: modifier,
        modifiers: modifierMask,
      });
    }

    await this.session.sendToTarget(this.targetId, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: mainKey,
      modifiers: modifierMask,
    });
    await this.session.sendToTarget(this.targetId, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: mainKey,
      modifiers: modifierMask,
    });

    for (const modifier of Array.from(modifiers).reverse()) {
      await this.session.sendToTarget(this.targetId, "Input.dispatchKeyEvent", {
        type: "keyUp",
        key: modifier,
        modifiers: modifierMask,
      });
    }
  }

  /**
   * Walk the DOM near `backendNodeId` looking for the closest
   * `<input type="file">`: self first, then descendants, then ancestors
   * up to 4 levels or the enclosing `<form>`. Returns the backend node id
   * of the discovered input so callers can upload via a visible trigger
   * button when the file input itself is hidden.
   */
  async findNearestFileInputBackendNodeId(
    backendNodeId: number,
  ): Promise<
    | { ok: true; backendNodeId: number }
    | { ok: false; reason: "index_stale" }
    | { ok: false; reason: "no_file_input" }
  > {
    const objectId = await this.resolveBackendNode(backendNodeId);
    if (!objectId) return { ok: false, reason: "index_stale" };
    try {
      const res = await this.session.sendToTarget<{
        result: { objectId?: string; subtype?: string };
        exceptionDetails?: RuntimeExceptionDetails;
      }>(this.targetId, "Runtime.callFunctionOn", {
        functionDeclaration: `function() {
          const isFileInput = (el) => el && el.tagName === "INPUT" && el.type === "file";
          if (isFileInput(this)) return this;
          if (this.querySelector) {
            const inside = this.querySelector('input[type="file"]');
            if (inside) return inside;
          }
          let node = this;
          for (let i = 0; i < 4 && node.parentElement; i++) {
            node = node.parentElement;
            if (node.querySelector) {
              const found = node.querySelector('input[type="file"]');
              if (found) return found;
            }
            if (node.tagName === "FORM") break;
          }
          return null;
        }`,
        objectId,
        returnByValue: false,
        awaitPromise: false,
      });
      if (res.exceptionDetails || !res.result.objectId) {
        return { ok: false, reason: "no_file_input" };
      }
      const foundObjectId = res.result.objectId;
      try {
        const desc = await this.session.sendToTarget<{
          node?: { backendNodeId?: number };
        }>(this.targetId, "DOM.describeNode", { objectId: foundObjectId });
        const found = desc.node?.backendNodeId;
        if (typeof found !== "number") return { ok: false, reason: "no_file_input" };
        return { ok: true, backendNodeId: found };
      } finally {
        await this.releaseObject(foundObjectId);
      }
    } finally {
      await this.releaseObject(objectId);
    }
  }

  async uploadFilesByBackendNodeId(
    backendNodeId: number,
    filePaths: string[],
  ): Promise<{ ok: true } | { ok: false; reason: "index_stale" }> {
    if (filePaths.length === 0) {
      throw new Error("uploadFilesByBackendNodeId requires at least one file path");
    }
    try {
      await this.session.sendToTarget(this.targetId, "DOM.setFileInputFiles", {
        backendNodeId,
        files: filePaths,
      });
      return { ok: true };
    } catch {
      return { ok: false, reason: "index_stale" };
    }
  }

  async scroll(
    direction: "up" | "down" | "top" | "bottom",
    amount = 800,
    backendNodeId?: number,
  ): Promise<{ ok: true } | { ok: false; reason: "index_stale" }> {
    if (backendNodeId === undefined) {
      const expr =
        direction === "up"
          ? `window.scrollBy(0, -${amount})`
          : direction === "down"
            ? `window.scrollBy(0, ${amount})`
            : direction === "top"
              ? "window.scrollTo(0, 0)"
              : "window.scrollTo(0, document.body.scrollHeight)";
      await this.evaluate(expr);
      return { ok: true };
    }

    const fnBody =
      direction === "up"
        ? `function(amount) { this.scrollBy(0, -amount); }`
        : direction === "down"
          ? `function(amount) { this.scrollBy(0, amount); }`
          : direction === "top"
            ? `function() { this.scrollTop = 0; }`
            : `function() { this.scrollTop = this.scrollHeight; }`;

    const result = await this.callOnBackendNode<void>(backendNodeId, fnBody, [amount]);
    if (!result.ok) return { ok: false, reason: "index_stale" };
    return { ok: true };
  }

  async scrollByPages(
    direction: "up" | "down" | "top" | "bottom",
    pages = 1.0,
    backendNodeId?: number,
  ): Promise<{ ok: true } | { ok: false; reason: "index_stale" }> {
    const viewportHeight = await this.evaluate<number>("window.innerHeight || 1000").catch(
      () => 1000,
    );
    if (direction === "top" || direction === "bottom") {
      return this.scroll(direction, viewportHeight, backendNodeId);
    }

    const fullPages = Math.max(0, Math.floor(pages));
    const fractional = Math.max(0, pages - fullPages);

    for (let i = 0; i < fullPages; i += 1) {
      const r = await this.scroll(direction, viewportHeight, backendNodeId);
      if (!r.ok) return r;
      await delay(150);
    }

    if (fractional > 0) {
      const r = await this.scroll(
        direction,
        Math.max(1, Math.floor(fractional * viewportHeight)),
        backendNodeId,
      );
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  async waitForText(text: string, timeoutMs = 10_000): Promise<boolean> {
    const escaped = JSON.stringify(text);
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const found = await this.evaluate<boolean>(
        `document.body?.innerText?.includes(${escaped}) ?? false`,
      );
      if (found) return true;
      await delay(100);
    }
    return false;
  }

  async scrollToText(text: string): Promise<boolean> {
    const escaped = JSON.stringify(text);
    return this.evaluate<boolean>(`(() => {
      const search = ${escaped};
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const value = (node.textContent || '').trim();
        if (!value) continue;
        if (!value.toLowerCase().includes(String(search).toLowerCase())) continue;
        const el = node.parentElement;
        if (!el) continue;
        el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
        return true;
      }
      return false;
    })()`);
  }

  async getPendingNetworkRequests(limit = 20): Promise<PendingNetworkRequest[]> {
    const data = await this.evaluate<{
      pending_requests: Array<{
        url: string;
        method?: string;
        loading_duration_ms?: number;
        resource_type?: string;
      }>;
    }>(`(() => {
      const now = performance.now();
      const resources = performance.getEntriesByType('resource');
      const pending = [];
      const adDomains = ${JSON.stringify(AD_DOMAINS)};

      for (const entry of resources) {
        if (entry.responseEnd !== 0) continue;
        const url = entry.name;
        if (adDomains.some((domain) => url.includes(domain))) continue;
        if (url.startsWith('data:') || url.length > 500) continue;

        const loadingDuration = now - entry.startTime;
        if (loadingDuration > 10000) continue;

        const resourceType = entry.initiatorType || 'unknown';
        const nonCriticalTypes = ['img', 'image', 'icon', 'font'];
        if (nonCriticalTypes.includes(resourceType) && loadingDuration > 3000) continue;
        if (/\\.(jpg|jpeg|png|gif|webp|svg|ico)(\\?|$)/i.test(url) && loadingDuration > 3000) continue;

        pending.push({
          url,
          method: 'GET',
          loading_duration_ms: Math.round(loadingDuration),
          resource_type: resourceType,
        });
      }

      return { pending_requests: pending };
    })()`);

    return (data.pending_requests ?? []).slice(0, limit).map((req) => ({
      url: req.url,
      method: req.method ?? "GET",
      loadingDurationMs: req.loading_duration_ms ?? 0,
      resourceType: req.resource_type ?? "unknown",
    }));
  }

  async waitForStablePage(timeoutMs = 3_000): Promise<void> {
    const startedAt = Date.now();
    let stablePolls = 0;
    while (Date.now() - startedAt < timeoutMs) {
      const status = await this.evaluate<{ readyState: string; pendingCount: number }>(`(() => {
        const resources = performance.getEntriesByType('resource');
        let pendingCount = 0;
        for (const entry of resources) {
          if (entry.responseEnd === 0) pendingCount += 1;
        }
        return { readyState: document.readyState, pendingCount };
      })()`);

      if (status.readyState === "complete" && status.pendingCount === 0) {
        stablePolls += 1;
        if (stablePolls >= 2) return;
      } else {
        stablePolls = 0;
      }
      await delay(120);
    }
  }

  async searchPage(params: SearchPageParams): Promise<{
    total: number;
    hasMore: boolean;
    matches: Array<{
      matchText: string;
      context: string;
      elementPath: string;
      charPosition: number;
    }>;
  }> {
    const payload = {
      pattern: params.pattern,
      regex: params.regex ?? false,
      caseSensitive: params.caseSensitive ?? false,
      contextChars: params.contextChars ?? 150,
      cssScope: params.cssScope ?? null,
      maxResults: params.maxResults ?? 25,
    };

    return this.evaluate(`(() => {
      const p = ${JSON.stringify(payload)};
      const scope = p.cssScope ? document.querySelector(p.cssScope) : document.body;
      if (!scope) return { total: 0, hasMore: false, matches: [] };

      const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
      let fullText = "";
      const nodeOffsets = [];
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const text = node.textContent || "";
        if (!text.trim()) continue;
        nodeOffsets.push({ offset: fullText.length, length: text.length, node });
        fullText += text;
      }

      let re;
      try {
        const flags = p.caseSensitive ? 'g' : 'gi';
        const escapeRegex = (v) => {
          let out = '';
          const specials = '.*+?^$()|[]\\\\';
          for (const ch of String(v)) {
            if (specials.includes(ch)) out += '\\\\' + ch;
            else out += ch;
          }
          return out;
        };
        re = p.regex ? new RegExp(p.pattern, flags) : new RegExp(escapeRegex(p.pattern), flags);
      } catch {
        return { total: 0, hasMore: false, matches: [] };
      }

      const matches = [];
      let total = 0;
      let match;
      while ((match = re.exec(fullText)) !== null) {
        total += 1;
        if (matches.length < p.maxResults) {
          const start = Math.max(0, match.index - p.contextChars);
          const end = Math.min(fullText.length, match.index + match[0].length + p.contextChars);
          const context = (start > 0 ? '...' : '') + fullText.slice(start, end) + (end < fullText.length ? '...' : '');

          let elementPath = '';
          for (const offset of nodeOffsets) {
            if (offset.offset <= match.index && offset.offset + offset.length > match.index) {
              const el = offset.node.parentElement;
              const parts = [];
              let current = el;
              while (current && current !== document.body && current !== document.documentElement) {
                let desc = current.tagName.toLowerCase();
                if (current.id) desc += '#' + current.id;
                parts.unshift(desc);
                current = current.parentElement;
              }
              elementPath = parts.join(' > ');
              break;
            }
          }

          matches.push({
            matchText: match[0],
            context,
            elementPath,
            charPosition: match.index,
          });
        }

        if (match[0].length === 0) re.lastIndex += 1;
      }

      return { total, hasMore: total > p.maxResults, matches };
    })()`);
  }

  async findElements(params: FindElementsParams): Promise<{
    total: number;
    showing: number;
    elements: Array<{
      index: number;
      tag: string;
      text?: string;
      attrs?: Record<string, string>;
      childrenCount: number;
    }>;
  }> {
    const payload = {
      selector: params.selector,
      attributes: params.attributes ?? null,
      maxResults: params.maxResults ?? 50,
      includeText: params.includeText ?? true,
    };

    return this.evaluate(`(() => {
      const p = ${JSON.stringify(payload)};
      let nodeList;
      try {
        nodeList = document.querySelectorAll(p.selector);
      } catch {
        return { total: 0, showing: 0, elements: [] };
      }

      const total = nodeList.length;
      const showing = Math.min(total, p.maxResults);
      const elements = [];
      for (let i = 0; i < showing; i += 1) {
        const el = nodeList[i];
        const item = {
          index: i,
          tag: el.tagName.toLowerCase(),
          childrenCount: el.children.length,
        };
        if (p.includeText) {
          const text = (el.textContent || '').trim();
          item.text = text.length > 300 ? text.slice(0, 300) + '...' : text;
        }
        if (Array.isArray(p.attributes) && p.attributes.length > 0) {
          item.attrs = {};
          for (const attr of p.attributes) {
            const val = (attr === 'src' || attr === 'href') && typeof el[attr] === 'string' ? el[attr] : el.getAttribute(attr);
            if (val != null) {
              item.attrs[attr] = val.length > 500 ? val.slice(0, 500) + '...' : val;
            }
          }
        }
        elements.push(item);
      }

      return { total, showing, elements };
    })()`);
  }

  async extractContent(params: ExtractContentParams): Promise<ExtractContentResult> {
    const payload = {
      query: params.query,
      extractLinks: params.extractLinks ?? false,
      extractImages: params.extractImages ?? false,
      startFromChar: params.startFromChar ?? 0,
      maxChars: params.maxChars ?? 100_000,
      alreadyCollected: params.alreadyCollected ?? [],
    };

    return this.evaluate(`(() => {
      const p = ${JSON.stringify(payload)};
      const title = (document.title || '').trim();
      const url = location.href;
      const body = document.body;

      const lines = [];
      const collapseWhitespace = (value) => {
        let out = '';
        let previousWasSpace = false;
        for (const ch of String(value || '')) {
          const isSpace = ch === ' ' || ch === '\\n' || ch === '\\r' || ch === '\\t' || ch === '\\f';
          if (isSpace) {
            if (!previousWasSpace) {
              out += ' ';
              previousWasSpace = true;
            }
          } else {
            out += ch;
            previousWasSpace = false;
          }
        }
        return out.trim();
      };

      if (title) {
        lines.push('# ' + title, '');
      }

      const text = (body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
      if (text) {
        lines.push(text);
      }

      const linkEntries = [];
      if (p.extractLinks && body) {
        const seen = new Set();
        const skipSet = new Set(p.alreadyCollected || []);
        for (const a of Array.from(body.querySelectorAll('a[href]'))) {
          const href = (a.getAttribute('href') || '').trim();
          if (!href) continue;
          const absHref = (() => {
            try {
              return new URL(href, location.href).toString();
            } catch {
              return href;
            }
          })();
          if (seen.has(absHref)) continue;
          if (skipSet.has(absHref)) continue;
          seen.add(absHref);
          const label = collapseWhitespace(a.textContent || a.getAttribute('aria-label') || '');
          linkEntries.push({ href: absHref, text: label || absHref });
        }
      }

      const imageEntries = [];
      if (p.extractImages && body) {
        const seen = new Set();
        for (const img of Array.from(body.querySelectorAll('img[src]'))) {
          const src = (img.getAttribute('src') || '').trim();
          if (!src) continue;
          const absSrc = (() => {
            try {
              return new URL(src, location.href).toString();
            } catch {
              return src;
            }
          })();
          if (seen.has(absSrc)) continue;
          seen.add(absSrc);
          const alt = collapseWhitespace(img.getAttribute('alt') || '');
          imageEntries.push({ src: absSrc, alt });
        }
      }

      if (linkEntries.length > 0) {
        lines.push('', '## Links', '');
        for (const item of linkEntries) {
          lines.push('- [' + item.text + '](' + item.href + ')');
        }
      }

      if (imageEntries.length > 0) {
        lines.push('', '## Images', '');
        for (const item of imageEntries) {
          lines.push('- ![' + (item.alt || 'image') + '](' + item.src + ')');
        }
      }

      const fullContent = lines.join('\\n').trim();
      const totalChars = fullContent.length;
      const start = Math.min(Math.max(0, p.startFromChar), totalChars);
      const end = Math.min(totalChars, start + p.maxChars);
      const chunk = fullContent.slice(start, end);
      const truncated = end < totalChars;

      return {
        url,
        query: p.query,
        content: chunk,
        stats: {
          totalChars,
          startFromChar: start,
          returnedChars: chunk.length,
          truncated,
          nextStartChar: truncated ? end : null,
          linksCount: linkEntries.length,
          imagesCount: imageEntries.length,
        },
      };
    })()`);
  }

  async getDropdownOptionsByBackendNodeId(
    backendNodeId: number,
  ): Promise<Array<{ value: string; text: string }>> {
    const result = await this.callOnBackendNode<Array<{ value: string; text: string }>>(
      backendNodeId,
      `function() {
        if (this.tagName !== "SELECT") return [];
        const out = [];
        for (const option of Array.from(this.options || [])) {
          out.push({ value: option.value, text: (option.label || option.textContent || "").trim() });
        }
        return out;
      }`,
    );
    if (!result.ok) return [];
    return result.value ?? [];
  }

  async waitForTimeout(ms: number): Promise<void> {
    await delay(ms);
  }

  async currentUrl(): Promise<string> {
    return this.evaluate<string>("location.href");
  }

  async close(): Promise<void> {
    await this.session.closePage(this.targetId);
  }

  async title(): Promise<string> {
    return this.evaluate<string>("document.title");
  }

  async content(): Promise<string> {
    return this.evaluate<string>("document.documentElement.outerHTML");
  }

  async screenshot(): Promise<string> {
    const result = await this.session.sendToTarget<{ data: string }>(
      this.targetId,
      "Page.captureScreenshot",
      { format: "png" },
    );
    return result.data;
  }

  async screenshotToFile(fileName?: string): Promise<string> {
    const base64 = await this.screenshot();
    const safeName = (
      fileName && fileName.trim().length > 0 ? fileName.trim() : `screenshot-${Date.now()}.png`
    ).replace(/[\\/:*?"<>|]/g, "_");
    const finalName = safeName.toLowerCase().endsWith(".png") ? safeName : `${safeName}.png`;
    const outputPath = join(process.cwd(), finalName);
    mkdirSync(dirname(outputPath), { recursive: true });
    const bytes = Buffer.from(base64, "base64");
    await writeFile(outputPath, bytes);
    return outputPath;
  }

  async saveAsPdf(options?: {
    fileName?: string;
    printBackground?: boolean;
    landscape?: boolean;
    scale?: number;
    paperFormat?: "Letter" | "Legal" | "A4" | "A3" | "Tabloid";
  }): Promise<string> {
    const paperSizes: Record<string, { width: number; height: number }> = {
      letter: { width: 8.5, height: 11 },
      legal: { width: 8.5, height: 14 },
      a4: { width: 8.27, height: 11.69 },
      a3: { width: 11.69, height: 16.54 },
      tabloid: { width: 11, height: 17 },
    };

    const selected = (options?.paperFormat ?? "Letter").toLowerCase();
    const paper = paperSizes[selected] ?? paperSizes.letter!;
    const scale = options?.scale ?? 1;

    const result = await this.session.sendToTarget<{ data: string }>(
      this.targetId,
      "Page.printToPDF",
      {
        printBackground: options?.printBackground ?? true,
        landscape: options?.landscape ?? false,
        scale: Math.min(2, Math.max(0.1, scale)),
        paperWidth: paper.width,
        paperHeight: paper.height,
        preferCSSPageSize: true,
      },
    );

    const rawFileName = options?.fileName?.trim() || `page-${Date.now()}.pdf`;
    const safeName = rawFileName.replace(/[\\/:*?"<>|]/g, "_");
    const finalName = safeName.toLowerCase().endsWith(".pdf") ? safeName : `${safeName}.pdf`;
    const outputPath = join(process.cwd(), finalName);
    mkdirSync(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, Buffer.from(result.data, "base64"));
    return outputPath;
  }
}
