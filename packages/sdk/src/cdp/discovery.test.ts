import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverBrowserExecutable, type BrowserChannel } from "./discovery";

describe("BrowserChannel", () => {
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
