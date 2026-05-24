import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

export type BrowserChannel =
  | "chrome-for-testing"
  | "chromium"
  | "chrome"
  | "chrome-beta"
  | "chrome-dev"
  | "chrome-canary"
  | "msedge"
  | "msedge-beta"
  | "msedge-dev"
  | "msedge-canary"
  | "lightpanda";

const DEFAULT_CHANNEL: BrowserChannel = "chrome-for-testing";

export interface BrowserInstallStatus {
  channel: BrowserChannel;
  executablePath: string | null;
  found: boolean;
  installable: boolean;
}

export interface BrowserInstallResult extends BrowserInstallStatus {
  installedNow: boolean;
}

interface PatternGroup {
  group: string;
  paths: string[];
}

function expandHome(value: string): string {
  if (!value.startsWith("~/")) return value;
  return join(homedir(), value.slice(2));
}

function maybePath(path: string): string | null {
  const expanded = expandHome(path);
  return existsSync(expanded) ? expanded : null;
}

function browserCacheDirs(): string[] {
  const dirs = [
    process.env.BROWSER_AGENT_BROWSERS_PATH,
    "~/.browser-agent/browsers",
    "~/.agent-browser/browsers",
  ].filter((dir): dir is string => Boolean(dir));
  return [...new Set(dirs.map(expandHome))];
}

function findExecutable(baseDir: string, executableName: string, maxDepth: number): string | null {
  if (!existsSync(baseDir)) return null;

  const pending: Array<{ path: string; depth: number }> = [{ path: baseDir, depth: 0 }];
  const matches: string[] = [];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;

    let entries;
    try {
      entries = readdirSync(current.path, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const path = join(current.path, entry.name);
      if (entry.isFile() && entry.name === executableName) {
        matches.push(path);
        continue;
      }
      if (entry.isDirectory() && current.depth < maxDepth) {
        pending.push({ path, depth: current.depth + 1 });
      }
    }
  }

  return matches.toSorted((a, b) => b.localeCompare(a))[0] ?? null;
}

function detectChromeForTestingBinary(): string | null {
  const executableName = process.platform === "win32" ? "chrome.exe" : "Google Chrome for Testing";

  for (const dir of browserCacheDirs()) {
    const found = findExecutable(dir, executableName, 8);
    if (found) return found;
  }

  return null;
}

function detectPlaywrightChromiumBinary(): string | null {
  const base = expandHome(
    process.env.PLAYWRIGHT_BROWSERS_PATH ??
      (process.platform === "darwin"
        ? "~/Library/Caches/ms-playwright"
        : process.platform === "win32"
          ? `${process.env.LOCALAPPDATA ?? ""}\\ms-playwright`
          : "~/.cache/ms-playwright"),
  );

  if (!existsSync(base)) return null;

  try {
    const entries = readdirSync(base, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .toSorted((a, b) => b.localeCompare(a));

    const candidates: string[] = [];
    for (const entry of entries) {
      if (!(entry.startsWith("chromium-") || entry.startsWith("chromium_headless_shell-"))) {
        continue;
      }

      if (process.platform === "darwin") {
        candidates.push(
          join(base, entry, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
        );
      } else if (process.platform === "linux") {
        candidates.push(join(base, entry, "chrome-linux", "chrome"));
        candidates.push(join(base, entry, "chrome-linux64", "chrome"));
      } else if (process.platform === "win32") {
        candidates.push(join(base, entry, "chrome-win", "chrome.exe"));
      }
    }

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    return null;
  }

  return null;
}

function groupsForPlatform(): PatternGroup[] {
  const playwrightPath = process.env.PLAYWRIGHT_BROWSERS_PATH;

  switch (process.platform) {
    case "darwin": {
      const pw = playwrightPath ?? "~/Library/Caches/ms-playwright";
      return [
        {
          group: "chrome-for-testing",
          paths: [
            "~/.browser-agent/browsers/chrome-*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
            "~/.agent-browser/browsers/chrome-*/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
          ],
        },
        {
          group: "chrome",
          paths: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
        },
        {
          group: "chromium",
          paths: [
            `${pw}/chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
          ],
        },
        {
          group: "chrome-canary",
          paths: ["/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary"],
        },
        {
          group: "msedge",
          paths: ["/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
        },
        {
          group: "chromium",
          paths: [
            `${pw}/chromium_headless_shell-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
          ],
        },
      ];
    }
    case "linux": {
      const pw = playwrightPath ?? "~/.cache/ms-playwright";
      return [
        {
          group: "chrome-for-testing",
          paths: [
            "~/.browser-agent/browsers/chrome-*/chrome-linux*/chrome",
            "~/.agent-browser/browsers/chrome-*/chrome-linux*/chrome",
          ],
        },
        {
          group: "chrome",
          paths: [
            "/usr/bin/google-chrome-stable",
            "/usr/bin/google-chrome",
            "/usr/local/bin/google-chrome",
          ],
        },
        {
          group: "chromium",
          paths: [
            `${pw}/chromium-*/chrome-linux*/chrome`,
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser",
            "/usr/local/bin/chromium",
            "/snap/bin/chromium",
          ],
        },
        { group: "chrome-beta", paths: ["/usr/bin/google-chrome-beta"] },
        { group: "chrome-dev", paths: ["/usr/bin/google-chrome-dev"] },
        { group: "msedge", paths: ["/usr/bin/microsoft-edge-stable", "/usr/bin/microsoft-edge"] },
        { group: "chromium", paths: [`${pw}/chromium_headless_shell-*/chrome-linux*/chrome`] },
      ];
    }
    case "win32": {
      const local = process.env.LOCALAPPDATA ?? "";
      const programFiles = process.env.PROGRAMFILES ?? "";
      const programFilesX86 = process.env["PROGRAMFILES(X86)"] ?? "";
      const pw = playwrightPath ?? `${local}\\ms-playwright`;
      return [
        {
          group: "chrome-for-testing",
          paths: [
            `${local}\\browser-agent\\browsers\\chrome-*\\chrome-win\\chrome.exe`,
            `${local}\\agent-browser\\browsers\\chrome-*\\chrome-win\\chrome.exe`,
          ],
        },
        {
          group: "chrome",
          paths: [
            "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
            `${local}\\Google\\Chrome\\Application\\chrome.exe`,
            `${programFiles}\\Google\\Chrome\\Application\\chrome.exe`,
            `${programFilesX86}\\Google\\Chrome\\Application\\chrome.exe`,
          ],
        },
        {
          group: "chromium",
          paths: [
            `${pw}\\chromium-*\\chrome-win\\chrome.exe`,
            "C:\\Program Files\\Chromium\\Application\\chrome.exe",
            "C:\\Program Files (x86)\\Chromium\\Application\\chrome.exe",
            `${local}\\Chromium\\Application\\chrome.exe`,
          ],
        },
        {
          group: "msedge",
          paths: [
            "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
            "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
            `${local}\\Microsoft\\Edge\\Application\\msedge.exe`,
          ],
        },
      ];
    }
    default:
      return [];
  }
}

const CHANNEL_TO_GROUP: Record<BrowserChannel, string> = {
  "chrome-for-testing": "chrome-for-testing",
  chromium: "chromium",
  chrome: "chrome",
  "chrome-beta": "chrome-beta",
  "chrome-dev": "chrome-dev",
  "chrome-canary": "chrome-canary",
  msedge: "msedge",
  "msedge-beta": "msedge",
  "msedge-dev": "msedge",
  "msedge-canary": "msedge",
  lightpanda: "lightpanda",
};

function discoverLightpandaExecutable(): string | null {
  const envOverride = process.env.LIGHTPANDA_PATH;
  if (envOverride && existsSync(envOverride)) {
    return envOverride;
  }

  const candidates = ["~/.cache/lightpanda/lightpanda", "/usr/local/bin/lightpanda"];
  for (const candidate of candidates) {
    const found = maybePath(candidate);
    if (found) return found;
  }

  try {
    const which = spawnSync("which", ["lightpanda"], { encoding: "utf-8" });
    if (which.status === 0) {
      const path = which.stdout.trim();
      if (path && existsSync(path)) {
        return path;
      }
    }
  } catch {
    // ignore
  }

  return null;
}

function chooseCandidates(channel: BrowserChannel): string[] {
  const groups = groupsForPlatform();
  const preferredGroup = CHANNEL_TO_GROUP[channel] ?? CHANNEL_TO_GROUP[DEFAULT_CHANNEL];
  const prioritized = groups.flatMap((g) => (g.group === preferredGroup ? g.paths : []));
  const rest = groups.flatMap((g) => (g.group === preferredGroup ? [] : g.paths));
  return [...prioritized, ...rest];
}

export function discoverBrowserExecutable(
  channel: BrowserChannel = DEFAULT_CHANNEL,
): string | null {
  if (channel === "lightpanda") {
    return discoverLightpandaExecutable();
  }

  const envOverride = process.env.BROWSER_AGENT_CHROME;
  if (envOverride && existsSync(envOverride)) {
    return envOverride;
  }

  if (channel === "chrome-for-testing") {
    const chromeForTesting = detectChromeForTestingBinary();
    if (chromeForTesting) return chromeForTesting;
  }

  for (const candidate of chooseCandidates(channel)) {
    if (candidate.includes("*")) continue;
    const found = maybePath(candidate);
    if (found) return found;
  }

  const playwrightChromium = detectPlaywrightChromiumBinary();
  if (playwrightChromium) {
    return playwrightChromium;
  }

  return null;
}

export function getBrowserInstallStatus(
  channel: BrowserChannel = DEFAULT_CHANNEL,
): BrowserInstallStatus {
  const executablePath = discoverBrowserExecutable(channel);
  return {
    channel,
    executablePath,
    found: Boolean(executablePath),
    installable: channel !== "lightpanda",
  };
}

function runCommand(command: string, args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(new Error(`Timed out running ${command} ${args.join(" ")}`));
    }, timeoutMs);

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Command failed (${command} ${args.join(" ")}): ${stderr.trim()}`));
    });
  });
}

async function installChromeForTesting(): Promise<void> {
  const path = join(homedir(), ".browser-agent", "browsers");
  const attempts: Array<{ command: string; args: string[] }> = [
    { command: "bunx", args: ["@puppeteer/browsers", "install", "chrome@stable", "--path", path] },
    { command: "npx", args: ["@puppeteer/browsers", "install", "chrome@stable", "--path", path] },
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      await runCommand(attempt.command, attempt.args, 120_000);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Failed to install Chrome for Testing");
}

export async function installBrowser(channel: BrowserChannel = DEFAULT_CHANNEL): Promise<void> {
  if (channel === "chrome-for-testing") {
    await installChromeForTesting();
    return;
  }

  await installChromiumWithPlaywright();
}

export async function installChromiumWithPlaywright(): Promise<void> {
  const attempts: Array<{ command: string; args: string[] }> = [
    { command: "bunx", args: ["playwright", "install", "chromium"] },
    { command: "npx", args: ["playwright", "install", "chromium"] },
  ];

  let lastError: Error | null = null;
  for (const attempt of attempts) {
    try {
      await runCommand(attempt.command, attempt.args, 120_000);
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error("Failed to install Chromium with Playwright");
}

export async function ensureBrowserExecutable(
  channel: BrowserChannel = DEFAULT_CHANNEL,
): Promise<BrowserInstallResult> {
  const before = getBrowserInstallStatus(channel);
  if (before.executablePath) {
    return { ...before, installedNow: false };
  }

  if (!before.installable) {
    return { ...before, installedNow: false };
  }

  await installBrowser(channel);
  const after = getBrowserInstallStatus(channel);
  return { ...after, installedNow: true };
}
