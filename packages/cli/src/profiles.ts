import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ProfilePaths {
  name: string;
  rootDir: string;
  userDataDir: string;
  storageStatePath: string;
}

export interface BrowserPathOptions {
  profile?: string;
  userDataDir?: string;
  storageStatePath?: string;
}

export function resolveProfilePaths(name: string, baseDir = defaultProfileBaseDir()): ProfilePaths {
  const safeName = normalizeProfileName(name);
  const rootDir = join(baseDir, safeName);
  return {
    name: safeName,
    rootDir,
    userDataDir: join(rootDir, "user-data"),
    storageStatePath: join(rootDir, "storage-state.json"),
  };
}

export function resolveBrowserPaths(options: BrowserPathOptions): BrowserPathOptions {
  if (!options.profile) return options;
  const paths = resolveProfilePaths(options.profile);
  mkdirSync(paths.rootDir, { recursive: true });
  return {
    ...options,
    profile: paths.name,
    userDataDir: options.userDataDir ?? paths.userDataDir,
    storageStatePath: options.storageStatePath ?? paths.storageStatePath,
  };
}

export function browserAgentHome(): string {
  return process.env.BROWSER_AGENT_HOME
    ? process.env.BROWSER_AGENT_HOME
    : join(homedir(), ".browser-agent");
}

function defaultProfileBaseDir(): string {
  return join(browserAgentHome(), "profiles");
}

function normalizeProfileName(name: string): string {
  const trimmed = name.trim();
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(trimmed) || trimmed === "." || trimmed === "..") {
    throw new Error(
      "Profile must be 1-80 chars and only use letters, numbers, dot, underscore, or dash.",
    );
  }
  return trimmed;
}
