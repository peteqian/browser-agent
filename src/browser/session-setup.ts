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
import { STEALTH_INIT_SCRIPT } from "./session-helpers";
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
  await client.send(
    "Page.addScriptToEvaluateOnNewDocument",
    { source: STEALTH_INIT_SCRIPT },
    sessionId,
  );
  if (profile.autoConsent) {
    await client.send(
      "Page.addScriptToEvaluateOnNewDocument",
      { source: AUTO_CONSENT_INIT_SCRIPT },
      sessionId,
    );
  }
  // Always override UA + UA-Client-Hints so we don't ship "HeadlessChrome"
  // when running headless. Bot detectors compare UA against
  // Sec-CH-UA headers and any inconsistency flips us to degraded layouts.
  const defaultUserAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
  const userAgent = profile.userAgent ?? defaultUserAgent;
  await client
    .send(
      "Emulation.setUserAgentOverride",
      {
        userAgent,
        acceptLanguage: profile.acceptLanguage ?? "en-US,en;q=0.9",
        platform: "MacIntel",
        userAgentMetadata: {
          brands: [
            { brand: "Google Chrome", version: "131" },
            { brand: "Chromium", version: "131" },
            { brand: "Not_A Brand", version: "24" },
          ],
          fullVersionList: [
            { brand: "Google Chrome", version: "131.0.6778.86" },
            { brand: "Chromium", version: "131.0.6778.86" },
            { brand: "Not_A Brand", version: "24.0.0.0" },
          ],
          platform: "macOS",
          platformVersion: "14.5.0",
          architecture: "arm",
          model: "",
          mobile: false,
          bitness: "64",
          wow64: false,
        },
      },
      sessionId,
    )
    .catch(() => {});
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
