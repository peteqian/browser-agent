import { mkdirSync } from "node:fs";

import type { CDPClient } from "../cdp/client";
import type { BrowserProfile } from "./profile";
import type { BrowserEventBus } from "./events";
import {
  buildLocalStorageRestoreScript,
  cookieToParam,
  createEmptyStorageState,
  readStorageStateFile,
  writeStorageStateFile,
  type BrowserOriginStorageState,
  type BrowserStorageState,
} from "./storage-state";
import { AUTO_CONSENT_INIT_SCRIPT } from "./auto-consent";
import {
  buildFingerprintInitScript,
  buildUserAgentOverride,
  resolveFingerprint,
} from "./fingerprint";
import type { Page } from "./page";

export async function configureDownloads(
  client: CDPClient,
  profile: BrowserProfile,
  eventBus: BrowserEventBus,
): Promise<void> {
  if (!profile.downloadsDir) return;
  mkdirSync(profile.downloadsDir, { recursive: true });
  try {
    await client.send("Browser.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: profile.downloadsDir,
      eventsEnabled: true,
    });
    void eventBus.emit({
      type: "browser_event",
      name: "download_watchdog_enabled",
      data: { downloadsDir: profile.downloadsDir },
    });
  } catch (error) {
    void eventBus.emit({
      type: "browser_error",
      message: "Failed to enable download watchdog",
      error,
    });
  }
}

export async function loadStorageState(
  client: CDPClient,
  profile: BrowserProfile,
  eventBus: BrowserEventBus,
): Promise<BrowserStorageState | null> {
  if (!profile.storageStatePath) return null;
  try {
    const state = await readStorageStateFile(profile.storageStatePath);
    if (!state) {
      void eventBus.emit({
        type: "browser_event",
        name: "storage_state_missing",
        data: { path: profile.storageStatePath },
      });
      return null;
    }

    if (state.cookies.length > 0) {
      await client.send("Storage.setCookies", {
        cookies: state.cookies.map(cookieToParam),
      });
    }

    void eventBus.emit({
      type: "browser_event",
      name: "storage_state_loaded",
      data: {
        path: profile.storageStatePath,
        cookieCount: state.cookies.length,
        originCount: state.origins.length,
        origins: state.origins.map((origin) => origin.origin),
      },
    });
    return state;
  } catch (error) {
    void eventBus.emit({
      type: "browser_event",
      name: "storage_state_failed",
      data: {
        path: profile.storageStatePath,
        operation: "load",
        error: error instanceof Error ? error.message : String(error),
      },
    });
    void eventBus.emit({
      type: "browser_error",
      message: "Failed to load storage state",
      error,
    });
    return null;
  }
}

export async function configurePermissions(
  client: CDPClient,
  profile: BrowserProfile,
  eventBus: BrowserEventBus,
): Promise<void> {
  for (const grant of profile.permissionGrants) {
    if (grant.permissions.length === 0) continue;

    const params: Record<string, unknown> = { permissions: grant.permissions };
    if (grant.origin) params.origin = grant.origin;

    try {
      await client.send("Browser.grantPermissions", params);
      void eventBus.emit({
        type: "browser_event",
        name: "permissions_watchdog_enabled",
        data: { permissions: grant.permissions, origin: grant.origin },
      });
    } catch (error) {
      void eventBus.emit({
        type: "browser_event",
        name: "permissions_watchdog_failed",
        data: {
          permissions: grant.permissions,
          origin: grant.origin,
          error: error instanceof Error ? error.message : String(error),
        },
      });
      void eventBus.emit({
        type: "browser_error",
        message: "Failed to configure permission grants",
        error,
      });
    }
  }
}

export async function enableDomains(
  client: CDPClient,
  sessionId: string,
  profile: BrowserProfile,
  loadedOrigins: BrowserOriginStorageState[],
): Promise<void> {
  await client.send("Page.enable", {}, sessionId);
  const storageScript = buildLocalStorageRestoreScript(loadedOrigins);
  if (storageScript) {
    await client.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: storageScript },
      sessionId,
    );
  }
  // Resolve once so the JS-visible patches and the UA/client-hints override
  // describe the same machine. Profile-level userAgent/acceptLanguage win
  // over the fingerprint profile for back-compat.
  const fingerprint =
    profile.fingerprintMode === "stealth"
      ? resolveFingerprint(profile.fingerprint, {
          userAgent: profile.userAgent,
          acceptLanguage: profile.acceptLanguage,
        })
      : null;
  if (fingerprint) {
    await client.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: buildFingerprintInitScript(fingerprint) },
      sessionId,
    );
  }
  if (profile.autoConsent) {
    await client.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: AUTO_CONSENT_INIT_SCRIPT },
      sessionId,
    );
  }
  for (const source of profile.initScripts) {
    if (source.length === 0) continue;
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source }, sessionId);
  }
  if (fingerprint) {
    // Override UA + UA-Client-Hints so headless mode does not ship
    // "HeadlessChrome". Native mode intentionally skips this so a real
    // browser/profile keeps its own coherent fingerprint.
    await client
      .send("Emulation.setUserAgentOverride", buildUserAgentOverride(fingerprint), sessionId)
      .catch(() => {});
  }
  if (profile.locale) {
    await client
      .send("Emulation.setLocaleOverride", { locale: profile.locale }, sessionId)
      .catch(() => {});
  }
  if (profile.timezoneId) {
    await client
      .send("Emulation.setTimezoneOverride", { timezoneId: profile.timezoneId }, sessionId)
      .catch(() => {});
  }
  await client.send("Runtime.enable", {}, sessionId);
  await client.send("DOM.enable", {}, sessionId);
  // Chrome 144+ pauses auto-attached targets "waiting for the debugger" even
  // with waitForDebuggerOnStart:false. If we never resume them the tab freezes
  // (Chrome shows "Debugger paused in another tab"). Resume here — last, after
  // all init scripts/overrides are registered — so the target proceeds.
  await client.send("Runtime.runIfWaitingForDebugger", {}, sessionId).catch(() => {});
}

export async function saveStorageState(
  client: CDPClient,
  profile: BrowserProfile,
  eventBus: BrowserEventBus,
  loadedOrigins: BrowserOriginStorageState[],
  listPages: () => Promise<Page[]>,
): Promise<void> {
  if (!profile.storageStatePath) return;
  const cookiesResponse = await client.send<{ cookies?: BrowserStorageState["cookies"] }>(
    "Storage.getCookies",
  );
  const collected = await collectOpenOriginStorage(listPages);
  const mergedOrigins = new Map<string, BrowserOriginStorageState>();
  for (const origin of loadedOrigins) mergedOrigins.set(origin.origin, origin);
  for (const origin of collected) mergedOrigins.set(origin.origin, origin);
  const state: BrowserStorageState = {
    ...createEmptyStorageState(),
    cookies: cookiesResponse.cookies ?? [],
    origins: Array.from(mergedOrigins.values()),
  };
  await writeStorageStateFile(profile.storageStatePath, state);
  void eventBus.emit({
    type: "browser_event",
    name: "storage_state_saved",
    data: {
      path: profile.storageStatePath,
      cookieCount: state.cookies.length,
      originCount: state.origins.length,
      origins: state.origins.map((origin) => origin.origin),
    },
  });
}

async function collectOpenOriginStorage(
  listPages: () => Promise<Page[]>,
): Promise<BrowserOriginStorageState[]> {
  const pages = await listPages().catch(() => []);
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
