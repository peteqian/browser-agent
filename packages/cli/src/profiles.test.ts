import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveBrowserPaths, resolveProfilePaths } from "./profiles";

describe("profile paths", () => {
  test("maps a named profile to stable browser paths", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "ba-profile-"));
    try {
      const paths = resolveProfilePaths("booking", baseDir);
      expect(paths.name).toBe("booking");
      expect(paths.rootDir).toBe(join(baseDir, "booking"));
      expect(paths.userDataDir).toBe(join(baseDir, "booking", "user-data"));
      expect(paths.storageStatePath).toBe(join(baseDir, "booking", "storage-state.json"));
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("rejects path traversal profile names", () => {
    expect(() => resolveProfilePaths("../booking")).toThrow(/Profile must/);
    expect(() => resolveProfilePaths("")).toThrow(/Profile must/);
  });

  test("fills missing paths from profile and keeps explicit overrides", () => {
    const home = mkdtempSync(join(tmpdir(), "ba-home-"));
    const prevHome = process.env.BROWSER_AGENT_HOME;
    process.env.BROWSER_AGENT_HOME = home;
    try {
      const resolved = resolveBrowserPaths({
        profile: "booking",
        storageStatePath: "/tmp/custom-state.json",
      });
      expect(resolved.userDataDir).toBe(join(home, "profiles", "booking", "user-data"));
      expect(resolved.storageStatePath).toBe("/tmp/custom-state.json");
      expect(resolved.profile).toBe("booking");
      expect(existsSync(join(home, "profiles", "booking"))).toBe(true);
    } finally {
      if (prevHome === undefined) delete process.env.BROWSER_AGENT_HOME;
      else process.env.BROWSER_AGENT_HOME = prevHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
