import { mkdirSync } from "node:fs";
import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type Protocol from "devtools-protocol";

export interface BrowserOriginStorageState {
  origin: string;
  localStorage: Record<string, string>;
}

export interface BrowserStorageState {
  version: 1;
  savedAt: string;
  cookies: Protocol.Network.Cookie[];
  origins: BrowserOriginStorageState[];
}

export function createEmptyStorageState(): BrowserStorageState {
  return { version: 1, savedAt: new Date().toISOString(), cookies: [], origins: [] };
}

export async function readStorageStateFile(path: string): Promise<BrowserStorageState | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
  return parseStorageState(JSON.parse(raw));
}

export async function writeStorageStateFile(
  path: string,
  state: BrowserStorageState,
): Promise<void> {
  mkdirSync(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  try {
    await rename(tempPath, path);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
}

export function cookieToParam(cookie: Protocol.Network.Cookie): Protocol.Network.CookieParam {
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    ...(cookie.expires >= 0 ? { expires: cookie.expires } : {}),
    priority: cookie.priority,
    sourceScheme: cookie.sourceScheme,
    sourcePort: cookie.sourcePort,
    partitionKey: cookie.partitionKey,
  };
}

/**
 * Builds a script for `Page.addScriptToEvaluateOnNewDocument`.
 * Note: this only restores localStorage for documents created *after*
 * the script is registered. Already-loaded pages won't be affected
 * until their next navigation.
 */
export function buildLocalStorageRestoreScript(
  origins: BrowserOriginStorageState[],
): string | null {
  if (origins.length === 0) return null;
  const storageByOrigin = Object.fromEntries(
    origins.map((origin) => [origin.origin, origin.localStorage]),
  );
  return `(() => {
  const storageByOrigin = ${JSON.stringify(storageByOrigin)};
  const values = storageByOrigin[location.origin];
  if (!values) return;
  try {
    for (const [key, value] of Object.entries(values)) {
      localStorage.setItem(key, String(value));
    }
  } catch {
    // localStorage may be unavailable for some documents.
  }
})()`;
}

function parseStorageState(input: unknown): BrowserStorageState {
  if (!input || typeof input !== "object") {
    throw new Error("Storage state must be an object");
  }
  const record = input as Record<string, unknown>;
  if (record.version !== 1) {
    throw new Error("Unsupported storage state version");
  }
  if (!Array.isArray(record.cookies)) {
    throw new Error("Storage state cookies must be an array");
  }
  if (!Array.isArray(record.origins)) {
    throw new Error("Storage state origins must be an array");
  }

  return {
    version: 1,
    savedAt: typeof record.savedAt === "string" ? record.savedAt : new Date().toISOString(),
    cookies: record.cookies.map(parseCookie),
    origins: record.origins.map(parseOriginStorageState),
  };
}

function parseCookie(input: unknown): Protocol.Network.Cookie {
  if (!input || typeof input !== "object") {
    throw new Error("Cookie must be an object");
  }
  const record = input as Record<string, unknown>;
  if (typeof record.name !== "string" || record.name.length === 0) {
    throw new Error("Cookie name must be a non-empty string");
  }
  if (typeof record.value !== "string") {
    throw new Error(`Cookie ${record.name} value must be a string`);
  }
  if (typeof record.domain !== "string" || record.domain.length === 0) {
    throw new Error(`Cookie ${record.name} domain must be a non-empty string`);
  }
  if (typeof record.path !== "string" || record.path.length === 0) {
    throw new Error(`Cookie ${record.name} path must be a non-empty string`);
  }
  return record as unknown as Protocol.Network.Cookie;
}

function parseOriginStorageState(input: unknown): BrowserOriginStorageState {
  if (!input || typeof input !== "object") {
    throw new Error("Storage state origin entry must be an object");
  }
  const record = input as Record<string, unknown>;
  if (typeof record.origin !== "string" || record.origin.length === 0) {
    throw new Error("Storage state origin must be a non-empty string");
  }
  if (!record.localStorage || typeof record.localStorage !== "object") {
    throw new Error(`Storage state localStorage for ${record.origin} must be an object`);
  }

  const localStorage: Record<string, string> = {};
  for (const [key, value] of Object.entries(record.localStorage)) {
    localStorage[key] = String(value);
  }
  return { origin: record.origin, localStorage };
}
