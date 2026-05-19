import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { Page } from "./page";
import type { BrowserProfile } from "./profile";
import {
  type BrowserOriginStorageState,
  type BrowserStorageState,
  createEmptyStorageState,
  readStorageStateFile,
  writeStorageStateFile,
} from "./storage-state";

import type Protocol from "devtools-protocol";

const NAME_PATTERN = /^[a-zA-Z0-9_-]+$/;

export interface StateVaultOptions {
  /** Override the vault directory. Falls back to BROWSER_AGENT_STATE_DIR env, then ~/.browser-agent/states. */
  dir?: string;
}

export interface StateSummary {
  name: string;
  path: string;
  cookiesCount: number;
  originsCount: number;
  sizeBytes: number;
  mtime: string;
}

export interface StateListEntry {
  name: string;
  path: string;
  sizeBytes: number;
  mtime: string;
}

export function resolveStateVaultDir(options: StateVaultOptions = {}): string {
  if (options.dir) return resolve(options.dir);
  const envDir = process.env.BROWSER_AGENT_STATE_DIR;
  if (envDir && envDir.length > 0) return resolve(envDir);
  return join(homedir(), ".browser-agent", "states");
}

function assertValidName(name: string): void {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("State name must be a non-empty string");
  }
  if (!NAME_PATTERN.test(name)) {
    throw new Error(
      `Invalid state name: ${JSON.stringify(name)}. Allowed: letters, digits, '_', '-'.`,
    );
  }
}

export function stateFilePath(name: string, options: StateVaultOptions = {}): string {
  assertValidName(name);
  return join(resolveStateVaultDir(options), `${name}.json`);
}

async function ensureVaultDir(options: StateVaultOptions): Promise<string> {
  const dir = resolveStateVaultDir(options);
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Capture cookies + localStorage from the page's session and write to the vault.
 * Uses Storage.getCookies on the browser target plus a localStorage dump for the page's origin.
 */
export async function saveState(
  name: string,
  page: Page,
  options: StateVaultOptions = {},
): Promise<StateSummary> {
  assertValidName(name);
  await ensureVaultDir(options);
  const path = stateFilePath(name, options);

  // Cookies: prefer browser-wide capture via the session client when available.
  let cookies: Protocol.Network.Cookie[] = [];
  const sessionClient = (page.session as unknown as { client?: { send?: Function } }).client;
  if (sessionClient && typeof sessionClient.send === "function") {
    try {
      const res = await (sessionClient.send as (m: string) => Promise<{ cookies?: Protocol.Network.Cookie[] }>)(
        "Storage.getCookies",
      );
      cookies = res.cookies ?? [];
    } catch {
      // Fall back to per-target getAllCookies below.
    }
  }
  if (cookies.length === 0) {
    try {
      const res = await page.sendCDP<{ cookies?: Protocol.Network.Cookie[] }>("Network.getAllCookies");
      cookies = res.cookies ?? [];
    } catch {
      cookies = [];
    }
  }

  const origins: BrowserOriginStorageState[] = [];
  try {
    const origin = await page.origin();
    if (origin && origin !== "null") {
      const localStorage = await page.readLocalStorage().catch(() => ({}));
      origins.push({ origin, localStorage });
    }
  } catch {
    // No origin available — empty origins is fine.
  }

  const state: BrowserStorageState = {
    ...createEmptyStorageState(),
    cookies,
    origins,
  };
  await writeStorageStateFile(path, state);
  return showState(name, options);
}

/**
 * Read a saved state. When `profile` is provided, write the saved state into the profile's
 * `storageStatePath` so subsequent launches pick it up. Returns the parsed state.
 */
export async function loadState(
  name: string,
  profile?: BrowserProfile,
  options: StateVaultOptions = {},
): Promise<BrowserStorageState> {
  assertValidName(name);
  const path = stateFilePath(name, options);
  const state = await readStorageStateFile(path);
  if (!state) {
    throw new Error(`State not found: ${name} (${path})`);
  }
  if (profile && profile.storageStatePath) {
    await writeStorageStateFile(profile.storageStatePath, state);
  }
  return state;
}

export async function listStates(options: StateVaultOptions = {}): Promise<StateListEntry[]> {
  const dir = resolveStateVaultDir(options);
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const out: StateListEntry[] = [];
  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    const name = entry.slice(0, -5);
    if (!NAME_PATTERN.test(name)) continue;
    const path = join(dir, entry);
    try {
      const st = await stat(path);
      out.push({
        name,
        path,
        sizeBytes: st.size,
        mtime: st.mtime.toISOString(),
      });
    } catch {
      // Skip entries we can't stat.
    }
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

export async function showState(
  name: string,
  options: StateVaultOptions = {},
): Promise<StateSummary> {
  assertValidName(name);
  const path = stateFilePath(name, options);
  const state = await readStorageStateFile(path);
  if (!state) {
    throw new Error(`State not found: ${name} (${path})`);
  }
  const st = await stat(path);
  return {
    name,
    path,
    cookiesCount: state.cookies.length,
    originsCount: state.origins.length,
    sizeBytes: st.size,
    mtime: st.mtime.toISOString(),
  };
}

export async function renameState(
  oldName: string,
  newName: string,
  options: StateVaultOptions = {},
): Promise<{ oldPath: string; newPath: string }> {
  assertValidName(oldName);
  assertValidName(newName);
  if (oldName === newName) {
    throw new Error("rename: old and new names are identical");
  }
  await ensureVaultDir(options);
  const oldPath = stateFilePath(oldName, options);
  const newPath = stateFilePath(newName, options);
  try {
    await stat(newPath);
    throw new Error(`State already exists: ${newName}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  try {
    await rename(oldPath, newPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`State not found: ${oldName}`);
    }
    throw error;
  }
  return { oldPath, newPath };
}

export async function clearState(
  name: string,
  options: StateVaultOptions = {},
): Promise<{ path: string; removed: boolean }> {
  assertValidName(name);
  const path = stateFilePath(name, options);
  try {
    await rm(path);
    return { path, removed: true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { path, removed: false };
    }
    throw error;
  }
}

export async function cleanAllStates(
  options: StateVaultOptions = {},
): Promise<{ removed: string[] }> {
  const entries = await listStates(options);
  const removed: string[] = [];
  for (const entry of entries) {
    try {
      await rm(entry.path);
      removed.push(entry.name);
    } catch {
      // Ignore individual failures; report the rest.
    }
  }
  return { removed };
}
