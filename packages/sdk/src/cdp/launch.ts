import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";

import {
  BrowserProfile,
  type BrowserFingerprintMode,
  type BrowserPermissionGrant,
} from "../browser/profile";
import { discoverBrowserExecutable, installBrowser, type BrowserChannel } from "./discovery";
import { buildChromeArgs, buildLightpandaArgs } from "./chrome-args";

export interface LaunchOptions {
  executablePath?: string;
  channel?: BrowserChannel;
  headless?: boolean;
  userDataDir?: string;
  proxyServer?: string;
  proxyBypass?: string;
  userAgent?: string;
  acceptLanguage?: string;
  locale?: string;
  timezoneId?: string;
  fingerprintMode?: BrowserFingerprintMode;
  extensionPaths?: string[];
  port?: number;
  docker?: boolean;
  disableSecurity?: boolean;
  extraArgs?: string[];
  maxRetries?: number;
  autoInstallBrowser?: boolean;
  downloadsDir?: string;
  permissionGrants?: BrowserPermissionGrant[];
  initScripts?: string[];
  storageStatePath?: string;
  saveStorageStateOnClose?: boolean;
  autoConsent?: boolean;
}

export interface LaunchedBrowser {
  process: ChildProcess;
  webSocketDebuggerUrl: string;
  debuggerAddress: string;
  executablePath: string;
  /** Path on disk for the launched profile. `undefined` when the engine does not use one (e.g. Lightpanda). */
  userDataDir?: string;
  ownsUserDataDir: boolean;
  close: () => Promise<void>;
  kill: () => Promise<void>;
}

const DEVTOOLS_LISTENING_REGEX = /DevTools listening on (ws:\/\/\S+)/;

function isUserDataDirError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("singletonlock") ||
    lower.includes("user data directory") ||
    lower.includes("already in use") ||
    lower.includes("cannot create")
  );
}

function createTempProfileDir(): string {
  return mkdtempSync(join(tmpdir(), "browser-agent-profile-"));
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to allocate free TCP port"));
        server.close();
        return;
      }
      const { port } = address;
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(port);
      });
    });
  });
}

async function waitForDebuggerEndpoint(
  child: ChildProcess,
  debuggerAddress: string,
  timeoutMs: number,
): Promise<string> {
  const startedAt = Date.now();
  let stderrBuffer = "";
  let terminalError: Error | null = null;

  const onExit = (code: number | null) => {
    terminalError = new Error(`Chrome exited before DevTools was ready (code ${String(code)})`);
  };
  child.once("exit", onExit);

  if (child.stderr) {
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      const direct = stderrBuffer.match(DEVTOOLS_LISTENING_REGEX)?.[1];
      if (direct) {
        terminalError = null;
      }
    });
  }

  try {
    while (Date.now() - startedAt < timeoutMs) {
      const direct = stderrBuffer.match(DEVTOOLS_LISTENING_REGEX)?.[1];
      if (direct) return direct;

      if (terminalError) {
        throw terminalError;
      }

      try {
        const response = await fetch(`http://${debuggerAddress}/json/version`);
        if (response.ok) {
          const data = (await response.json()) as { webSocketDebuggerUrl?: string };
          if (
            typeof data.webSocketDebuggerUrl === "string" &&
            data.webSocketDebuggerUrl.length > 0
          ) {
            return data.webSocketDebuggerUrl;
          }
        }
      } catch {
        // ignore while browser boots
      }

      await new Promise((resolve) => setTimeout(resolve, 120));
    }
  } finally {
    child.removeListener("exit", onExit);
  }

  throw new Error(`Timed out waiting for DevTools endpoint on ${debuggerAddress}`);
}

async function terminateChild(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return;
  signalChildTree(child, "SIGTERM");
  const exited = await waitForExit(child, 2_000);
  if (exited) return;
  signalChildTree(child, "SIGKILL");
  await waitForExit(child, 1_000);
}

async function killChild(child: ChildProcess): Promise<void> {
  if (hasExited(child)) return;
  signalChildTree(child, "SIGKILL");
  await waitForExit(child, 1_000);
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function signalChildTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" && typeof child.pid === "number") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {
      // Fall through to signaling the direct child below.
    }
  }
  child.kill(signal);
}

async function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function resolveExecutable(
  executablePath: string | undefined,
  channel: BrowserChannel,
  autoInstallBrowser: boolean,
): Promise<string> {
  if (executablePath) return executablePath;

  const found = discoverBrowserExecutable(channel);
  if (found) return found;

  if (channel === "lightpanda") {
    throw new Error("Lightpanda binary not found. Install from https://lightpanda.io");
  }

  if (!autoInstallBrowser) {
    throw new Error(
      `Could not find browser executable for channel=${channel}. Set executablePath or BROWSER_AGENT_CHROME.`,
    );
  }

  await installBrowser(channel);
  const installed = discoverBrowserExecutable(channel);
  if (installed) return installed;

  throw new Error(
    `Installed browser for channel=${channel}, but executable is still not discoverable`,
  );
}

async function launchAttempt(
  executablePath: string,
  profile: Required<
    Pick<
      LaunchOptions,
      "headless" | "docker" | "disableSecurity" | "extraArgs" | "maxRetries" | "autoInstallBrowser"
    >
  > & {
    channel: BrowserChannel;
    userDataDir?: string;
    proxyServer?: string;
    proxyBypass?: string;
    userAgent?: string;
    acceptLanguage?: string;
    locale?: string;
    timezoneId?: string;
    fingerprintMode?: BrowserFingerprintMode;
    extensionPaths?: string[];
    port?: number;
  },
): Promise<LaunchedBrowser> {
  const isLightpanda = profile.channel === "lightpanda";
  const ownsUserDataDir = !isLightpanda && !profile.userDataDir;
  const userDataDir = isLightpanda ? undefined : (profile.userDataDir ?? createTempProfileDir());
  const port = profile.port ?? (await findFreePort());
  const debuggerAddress = `127.0.0.1:${port}`;

  const args = isLightpanda
    ? buildLightpandaArgs(port)
    : buildChromeArgs({
        remoteDebuggingPort: port,
        userDataDir: userDataDir as string,
        headless: profile.headless,
        docker: profile.docker,
        disableSecurity: profile.disableSecurity,
        fingerprintMode: profile.fingerprintMode,
        proxyServer: profile.proxyServer,
        proxyBypass: profile.proxyBypass,
        userAgent: profile.userAgent,
        acceptLanguage: profile.acceptLanguage,
        extensionPaths: profile.extensionPaths,
        extra: profile.extraArgs,
      });

  const child = spawn(executablePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  let webSocketDebuggerUrl: string;
  try {
    webSocketDebuggerUrl = await waitForDebuggerEndpoint(child, debuggerAddress, 20_000);
  } catch (error) {
    await killChild(child);
    if (ownsUserDataDir && userDataDir) {
      rmSync(userDataDir, { recursive: true, force: true });
    }
    throw error;
  }

  return {
    process: child,
    webSocketDebuggerUrl,
    debuggerAddress,
    executablePath,
    userDataDir,
    ownsUserDataDir,
    close: async () => {
      await terminateChild(child);
      if (ownsUserDataDir && userDataDir) {
        rmSync(userDataDir, { recursive: true, force: true });
      }
    },
    kill: async () => {
      await killChild(child);
      if (ownsUserDataDir && userDataDir) {
        rmSync(userDataDir, { recursive: true, force: true });
      }
    },
  };
}

export async function launchBrowser(options: LaunchOptions = {}): Promise<LaunchedBrowser> {
  const maxRetries = options.maxRetries ?? 3;
  const channel = options.channel ?? "chrome-for-testing";
  const autoInstallBrowser = options.autoInstallBrowser ?? true;
  const executablePath = await resolveExecutable(
    options.executablePath,
    channel,
    autoInstallBrowser,
  );

  let attemptOptions: LaunchOptions = { ...options };
  const tempDirsToCleanup: string[] = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const launched = await launchAttempt(executablePath, {
        channel,
        headless: attemptOptions.headless ?? true,
        docker: attemptOptions.docker ?? false,
        disableSecurity: attemptOptions.disableSecurity ?? false,
        extraArgs: attemptOptions.extraArgs ?? [],
        proxyServer: attemptOptions.proxyServer,
        proxyBypass: attemptOptions.proxyBypass,
        userAgent: attemptOptions.userAgent,
        acceptLanguage: attemptOptions.acceptLanguage,
        locale: attemptOptions.locale,
        timezoneId: attemptOptions.timezoneId,
        fingerprintMode: attemptOptions.fingerprintMode,
        extensionPaths: attemptOptions.extensionPaths,
        userDataDir: attemptOptions.userDataDir,
        port: attemptOptions.port,
        maxRetries,
        autoInstallBrowser,
      });

      for (const staleTempDir of tempDirsToCleanup) {
        if (staleTempDir !== launched.userDataDir) {
          rmSync(staleTempDir, { recursive: true, force: true });
        }
      }

      return launched;
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      if (attempt >= maxRetries || !isUserDataDirError(error.message)) {
        for (const staleTempDir of tempDirsToCleanup) {
          rmSync(staleTempDir, { recursive: true, force: true });
        }
        throw error;
      }

      const nextTempProfile = createTempProfileDir();
      tempDirsToCleanup.push(nextTempProfile);
      attemptOptions.userDataDir = nextTempProfile;
    }
  }

  throw new Error("Failed to launch browser after retries");
}

export async function launchBrowserFromProfile(profile: BrowserProfile): Promise<LaunchedBrowser> {
  return launchBrowser({
    executablePath: profile.executablePath,
    channel: profile.channel,
    headless: profile.headless,
    userDataDir: profile.userDataDir,
    proxyServer: profile.proxyServer,
    proxyBypass: profile.proxyBypass,
    userAgent: profile.userAgent,
    acceptLanguage: profile.acceptLanguage,
    locale: profile.locale,
    timezoneId: profile.timezoneId,
    fingerprintMode: profile.fingerprintMode,
    extensionPaths: profile.extensionPaths,
    port: profile.remoteDebuggingPort,
    docker: profile.docker,
    disableSecurity: profile.disableSecurity,
    extraArgs: profile.extraArgs,
    maxRetries: profile.maxLaunchRetries,
    autoInstallBrowser: profile.autoInstallBrowser,
    downloadsDir: profile.downloadsDir,
    storageStatePath: profile.storageStatePath,
    saveStorageStateOnClose: profile.saveStorageStateOnClose,
  });
}
