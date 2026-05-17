import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

export type BrowserChannel =
  | "chromium"
  | "chrome"
  | "chrome-beta"
  | "chrome-dev"
  | "chrome-canary"
  | "msedge"
  | "msedge-beta"
  | "msedge-dev"
  | "msedge-canary";

const DEFAULT_CHANNEL: BrowserChannel = "chromium";

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
  chromium: "chromium",
  chrome: "chrome",
  "chrome-beta": "chrome-beta",
  "chrome-dev": "chrome-dev",
  "chrome-canary": "chrome-canary",
  msedge: "msedge",
  "msedge-beta": "msedge",
  "msedge-dev": "msedge",
  "msedge-canary": "msedge",
};

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
  const envOverride = process.env.BROWSER_AGENT_CHROME;
  if (envOverride && existsSync(envOverride)) {
    return envOverride;
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
