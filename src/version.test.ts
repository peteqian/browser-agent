import { describe, expect, test } from "bun:test";

import { PACKAGE_NAME, VERSION } from "./version";

describe("version", () => {
  test("VERSION is a non-empty string in semver-ish shape", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("PACKAGE_NAME matches the published package name", () => {
    expect(PACKAGE_NAME).toBe("@peteqian/browser-agent");
  });
});
