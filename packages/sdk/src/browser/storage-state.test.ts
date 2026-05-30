import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildLocalStorageRestoreScript,
  createEmptyStorageState,
  readStorageStateFile,
  writeStorageStateFile,
} from "./storage-state";

let tempDir = "";

afterEach(() => {
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
});

function makeTempDir(): string {
  tempDir = mkdtempSync(join(tmpdir(), "browser-agent-storage-state-"));
  return tempDir;
}

describe("storage state helpers", () => {
  test("reads missing storage state files as null", async () => {
    const state = await readStorageStateFile(join(makeTempDir(), "missing.json"));

    expect(state).toBeNull();
  });

  test("writes storage state files atomically with json content", async () => {
    const path = join(makeTempDir(), "storage.json");
    const state = createEmptyStorageState();

    await writeStorageStateFile(path, state);

    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(state);
  });

  test("builds origin-scoped localStorage restore script", () => {
    const script = buildLocalStorageRestoreScript([
      { origin: "https://example.com", localStorage: { token: "secret", theme: "dark" } },
    ]);

    expect(script).toContain("https://example.com");
    expect(script).toContain("localStorage.setItem");
    expect(buildLocalStorageRestoreScript([])).toBeNull();
  });
});
