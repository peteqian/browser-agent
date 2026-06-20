import { describe, expect, test } from "bun:test";

import { resolveBrowserPaths, resolveProfilePaths } from "./profile-paths";

describe("profile paths", () => {
  test("maps a named profile to stable browser paths", () => {
    const paths = resolveProfilePaths("seek", "/tmp/browser-agent-test-profiles");

    expect(paths).toEqual({
      name: "seek",
      rootDir: "/tmp/browser-agent-test-profiles/seek",
      userDataDir: "/tmp/browser-agent-test-profiles/seek/user-data",
      storageStatePath: "/tmp/browser-agent-test-profiles/seek/storage-state.json",
    });
  });

  test("preserves explicit paths when a profile is present", () => {
    const paths = resolveBrowserPaths({
      profile: "work",
      userDataDir: "/tmp/custom-user-data",
      storageStatePath: "/tmp/custom-state.json",
    });

    expect(paths.userDataDir).toBe("/tmp/custom-user-data");
    expect(paths.storageStatePath).toBe("/tmp/custom-state.json");
  });

  test("rejects unsafe profile names", () => {
    expect(() => resolveProfilePaths("../nope")).toThrow("Profile must be");
  });
});
