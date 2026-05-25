import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  discoverBrowserExecutable,
  getBrowserInstallStatus,
  ensureBrowserExecutable,
  type BrowserChannel,
} from "./discovery";

describe("BrowserChannel", () => {
  it("accepts chrome-for-testing channel", () => {
    const ch: BrowserChannel = "chrome-for-testing";
    expect(ch).toBe("chrome-for-testing");
  });

  it("accepts lightpanda channel", () => {
    const ch: BrowserChannel = "lightpanda";
    expect(ch).toBe("lightpanda");
  });
});

describe("discoverBrowserExecutable(lightpanda)", () => {
  let dir: string;
  let stubPath: string;
  const prevEnv = process.env.LIGHTPANDA_PATH;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "lightpanda-discovery-"));
    stubPath = join(dir, "lightpanda");
    writeFileSync(stubPath, "#!/bin/sh\nexit 0\n");
    chmodSync(stubPath, 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prevEnv === undefined) {
      delete process.env.LIGHTPANDA_PATH;
    } else {
      process.env.LIGHTPANDA_PATH = prevEnv;
    }
  });

  it("returns LIGHTPANDA_PATH when set and the file exists", () => {
    process.env.LIGHTPANDA_PATH = stubPath;
    expect(discoverBrowserExecutable("lightpanda")).toBe(stubPath);
  });

  it("does not honor LIGHTPANDA_PATH for chrome channel", () => {
    process.env.LIGHTPANDA_PATH = stubPath;
    const result = discoverBrowserExecutable("chrome");
    expect(result).not.toBe(stubPath);
  });
});

describe("browser install status", () => {
  let dir: string;
  let stubPath: string;
  const prevChrome = process.env.BROWSER_AGENT_CHROME;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "chrome-discovery-"));
    stubPath = join(dir, "chrome");
    writeFileSync(stubPath, "#!/bin/sh\nexit 0\n");
    chmodSync(stubPath, 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    if (prevChrome === undefined) {
      delete process.env.BROWSER_AGENT_CHROME;
    } else {
      process.env.BROWSER_AGENT_CHROME = prevChrome;
    }
  });

  it("reports the resolved browser executable", () => {
    process.env.BROWSER_AGENT_CHROME = stubPath;

    expect(getBrowserInstallStatus("chrome-for-testing")).toEqual({
      channel: "chrome-for-testing",
      executablePath: stubPath,
      found: true,
      installable: true,
    });
  });

  it("does not run install when an executable is already available", async () => {
    process.env.BROWSER_AGENT_CHROME = stubPath;

    await expect(ensureBrowserExecutable("chrome-for-testing")).resolves.toEqual({
      channel: "chrome-for-testing",
      executablePath: stubPath,
      found: true,
      installable: true,
      installedNow: false,
    });
  });
});
