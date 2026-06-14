import type { BrowserChannel } from "../../cdp/discovery";
import type Protocol from "devtools-protocol";
import type { FingerprintInit } from "./fingerprint";
import type { HumanizeInit } from "./humanize";

export type BrowserPermission = Protocol.Browser.PermissionType;

export interface BrowserPermissionGrant {
  permissions: BrowserPermission[];
  origin?: string;
}

export interface BrowserProfileInit {
  cdpUrl?: string;
  executablePath?: string;
  channel?: BrowserChannel;
  /** Engine shorthand. "lightpanda" maps to channel "lightpanda"; "chrome" preserves channel default. */
  engine?: "chrome" | "lightpanda";
  headless?: boolean;
  userDataDir?: string;
  proxyServer?: string;
  proxyBypass?: string;
  userAgent?: string;
  acceptLanguage?: string;
  locale?: string;
  timezoneId?: string;
  /**
   * Browser fingerprint policy.
   * - "stealth": install lightweight headless-detection patches and a stable
   *   user-agent override.
   * - "native": preserve the browser's own JS-visible surface. Use this when
   *   attaching to a real headed/profile browser and a human may complete
   *   site checks manually.
   */
  fingerprintMode?: BrowserFingerprintMode;
  /**
   * How the browser presents itself when `fingerprintMode` is "stealth":
   * a preset name ("macos-chrome" | "windows-chrome" | "linux-chrome") or a
   * partial FingerprintProfile merged over a preset. Ignored in "native" mode.
   */
  fingerprint?: FingerprintInit;
  /**
   * Human-like input synthesis (curved mouse paths, typing cadence).
   * `true` or a HumanizeConfig enables it for all clicks/typing. Default: off.
   */
  humanize?: HumanizeInit;
  extensionPaths?: string[];
  remoteDebuggingPort?: number;
  docker?: boolean;
  disableSecurity?: boolean;
  extraArgs?: string[];
  maxLaunchRetries?: number;
  autoInstallBrowser?: boolean;
  reconnectOnDisconnect?: boolean;
  reconnectMaxAttempts?: number;
  reconnectBaseDelayMs?: number;
  reconnectMaxDelayMs?: number;
  captchaSolver?: boolean;
  downloadsDir?: string;
  permissionGrants?: BrowserPermissionGrant[];
  storageStatePath?: string;
  saveStorageStateOnClose?: boolean;
  /** Directory for the named-state vault. Defaults to BROWSER_AGENT_STATE_DIR env or ~/.browser-agent/states. */
  stateVaultDir?: string;
  /** Inject an init script that auto-dismisses common cookie/consent banners. Default: false. */
  autoConsent?: boolean;
  /**
   * JavaScript sources registered via `Page.addScriptToEvaluateOnNewDocument`
   * on every new page in this session. Runs before any page script on each
   * navigation. Useful for auth-token injection, time mocking, or stubbing
   * globals. Each entry is a raw JS source string.
   */
  initScripts?: readonly string[];
}

export type BrowserFingerprintMode = "stealth" | "native";

export class BrowserProfile {
  cdpUrl: string | undefined;
  executablePath: string | undefined;
  channel: BrowserChannel;
  headless: boolean;
  userDataDir: string | undefined;
  proxyServer: string | undefined;
  proxyBypass: string | undefined;
  userAgent: string | undefined;
  acceptLanguage: string | undefined;
  locale: string | undefined;
  timezoneId: string | undefined;
  fingerprintMode: BrowserFingerprintMode;
  fingerprint: FingerprintInit | undefined;
  humanize: HumanizeInit | undefined;
  extensionPaths: string[];
  remoteDebuggingPort: number | undefined;
  docker: boolean;
  disableSecurity: boolean;
  extraArgs: string[];
  maxLaunchRetries: number;
  autoInstallBrowser: boolean;
  reconnectOnDisconnect: boolean;
  reconnectMaxAttempts: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  captchaSolver: boolean;
  downloadsDir: string | undefined;
  permissionGrants: BrowserPermissionGrant[];
  storageStatePath: string | undefined;
  saveStorageStateOnClose: boolean;
  stateVaultDir: string | undefined;
  autoConsent: boolean;
  initScripts: string[];

  constructor(init: BrowserProfileInit = {}) {
    this.cdpUrl = init.cdpUrl;
    this.executablePath = init.executablePath;
    this.channel =
      init.channel ?? (init.engine === "lightpanda" ? "lightpanda" : "chrome-for-testing");
    this.headless = init.headless ?? true;
    this.userDataDir = init.userDataDir;
    this.proxyServer = init.proxyServer;
    this.proxyBypass = init.proxyBypass;
    this.userAgent = init.userAgent;
    this.acceptLanguage = init.acceptLanguage;
    this.locale = init.locale;
    this.timezoneId = init.timezoneId;
    this.fingerprintMode = init.fingerprintMode ?? "stealth";
    this.fingerprint = init.fingerprint;
    this.humanize = init.humanize;
    this.extensionPaths = init.extensionPaths ?? [];
    this.remoteDebuggingPort = init.remoteDebuggingPort;
    this.docker = init.docker ?? false;
    this.disableSecurity = init.disableSecurity ?? false;
    this.extraArgs = init.extraArgs ?? [];
    this.maxLaunchRetries = init.maxLaunchRetries ?? 3;
    this.autoInstallBrowser = init.autoInstallBrowser ?? true;
    this.reconnectOnDisconnect = init.reconnectOnDisconnect ?? true;
    this.reconnectMaxAttempts = init.reconnectMaxAttempts ?? 6;
    this.reconnectBaseDelayMs = init.reconnectBaseDelayMs ?? 500;
    this.reconnectMaxDelayMs = init.reconnectMaxDelayMs ?? 8_000;
    this.captchaSolver = init.captchaSolver ?? true;
    this.downloadsDir = init.downloadsDir;
    this.permissionGrants =
      init.permissionGrants?.map((grant) => ({
        ...grant,
        permissions: [...grant.permissions],
      })) ?? [];
    this.storageStatePath = init.storageStatePath;
    this.saveStorageStateOnClose = init.saveStorageStateOnClose ?? Boolean(init.storageStatePath);
    this.stateVaultDir = init.stateVaultDir;
    this.autoConsent = init.autoConsent ?? false;
    this.initScripts = init.initScripts ? [...init.initScripts] : [];
  }

  isRemoteConnection(): boolean {
    return typeof this.cdpUrl === "string" && this.cdpUrl.length > 0;
  }

  isManagedLocal(): boolean {
    return !this.isRemoteConnection();
  }
}
