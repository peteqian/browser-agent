import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  clearProfile,
  listProfiles,
  resolveBrowserPaths,
  resolveProfilePaths,
  showProfile,
} from "./profiles";

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

  test("lists and shows existing profile directories", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "ba-profile-list-"));
    try {
      const alpha = resolveProfilePaths("alpha", baseDir);
      const beta = resolveProfilePaths("beta", baseDir);
      mkdirSync(alpha.userDataDir, { recursive: true });
      mkdirSync(beta.rootDir, { recursive: true });
      writeFileSync(beta.storageStatePath, "{}");

      expect(listProfiles(baseDir).map((profile) => profile.name)).toEqual(["alpha", "beta"]);
      expect(showProfile("alpha", baseDir)).toMatchObject({
        name: "alpha",
        exists: true,
        userDataDirExists: true,
        storageStateExists: false,
      });
      expect(showProfile("beta", baseDir)).toMatchObject({
        name: "beta",
        exists: true,
        userDataDirExists: false,
        storageStateExists: true,
      });
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  test("clears a profile without touching sibling profiles", () => {
    const baseDir = mkdtempSync(join(tmpdir(), "ba-profile-clear-"));
    try {
      const doomed = resolveProfilePaths("doomed", baseDir);
      const keep = resolveProfilePaths("keep", baseDir);
      mkdirSync(doomed.userDataDir, { recursive: true });
      mkdirSync(keep.userDataDir, { recursive: true });

      const cleared = clearProfile("doomed", baseDir);

      expect(cleared.exists).toBe(false);
      expect(existsSync(doomed.rootDir)).toBe(false);
      expect(existsSync(keep.rootDir)).toBe(true);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
