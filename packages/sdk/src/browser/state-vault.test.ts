import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmptyStorageState, writeStorageStateFile } from "./storage-state";
import {
  cleanAllStates,
  clearState,
  listStates,
  loadState,
  renameState,
  resolveStateVaultDir,
  showState,
  stateFilePath,
} from "./state-vault";
import { BrowserProfile } from "./profile";

let tempDir = "";
const ENV_KEY = "BROWSER_AGENT_STATE_DIR";
let prevEnv: string | undefined;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "browser-agent-state-vault-"));
  prevEnv = process.env[ENV_KEY];
  process.env[ENV_KEY] = tempDir;
});

afterEach(() => {
  if (prevEnv === undefined) {
    delete process.env[ENV_KEY];
  } else {
    process.env[ENV_KEY] = prevEnv;
  }
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
});

async function writeFixture(name: string, cookies = 0, origins = 0): Promise<string> {
  const path = stateFilePath(name);
  const state = createEmptyStorageState();
  for (let i = 0; i < cookies; i++) {
    state.cookies.push({
      name: `c${i}`,
      value: "v",
      domain: "example.com",
      path: "/",
      expires: -1,
      size: 1,
      httpOnly: false,
      secure: false,
      session: true,
      priority: "Medium",
      sameParty: false,
      sourceScheme: "Secure",
      sourcePort: 443,
    } as never);
  }
  for (let i = 0; i < origins; i++) {
    state.origins.push({ origin: `https://o${i}.test`, localStorage: { k: "v" } });
  }
  await writeStorageStateFile(path, state);
  return path;
}

describe("state vault", () => {
  test("resolves dir from env override", () => {
    expect(resolveStateVaultDir()).toBe(tempDir);
  });

  test("explicit dir option wins over env", () => {
    expect(resolveStateVaultDir({ dir: "/tmp/other" })).toBe("/tmp/other");
  });

  test("rejects invalid names", async () => {
    await expect(showState("../bad")).rejects.toThrow();
    await expect(showState("with space")).rejects.toThrow();
    await expect(showState("")).rejects.toThrow();
  });

  test("list returns empty when dir missing", async () => {
    rmSync(tempDir, { recursive: true, force: true });
    const items = await listStates();
    expect(items).toEqual([]);
  });

  test("list, show, load, clear round-trip", async () => {
    await writeFixture("alpha", 2, 1);
    await writeFixture("beta");

    const entries = await listStates();
    expect(entries.map((e) => e.name)).toEqual(["alpha", "beta"]);

    const summary = await showState("alpha");
    expect(summary.cookiesCount).toBe(2);
    expect(summary.originsCount).toBe(1);
    expect(summary.sizeBytes).toBeGreaterThan(0);

    const loaded = await loadState("alpha");
    expect(loaded.cookies.length).toBe(2);

    const cleared = await clearState("alpha");
    expect(cleared.removed).toBe(true);
    expect(existsSync(cleared.path)).toBe(false);

    const noop = await clearState("alpha");
    expect(noop.removed).toBe(false);
  });

  test("loadState writes into profile.storageStatePath when provided", async () => {
    await writeFixture("gamma", 1);
    const targetPath = join(tempDir, "applied.json");
    const profile = new BrowserProfile({ storageStatePath: targetPath });

    await loadState("gamma", profile);

    const raw = await readFile(targetPath, "utf8");
    const parsed = JSON.parse(raw);
    expect(parsed.cookies.length).toBe(1);
  });

  test("rename moves the file and refuses collisions", async () => {
    await writeFixture("one");
    await writeFixture("two");

    await expect(renameState("one", "two")).rejects.toThrow(/already exists/);

    const moved = await renameState("one", "three");
    expect(existsSync(moved.oldPath)).toBe(false);
    expect(existsSync(moved.newPath)).toBe(true);

    await expect(renameState("missing", "anything")).rejects.toThrow(/not found/);
  });

  test("cleanAllStates removes every entry", async () => {
    await writeFixture("a");
    await writeFixture("b");
    const res = await cleanAllStates();
    expect(res.removed.sort()).toEqual(["a", "b"]);
    expect(await listStates()).toEqual([]);
  });

  test("loadState rejects missing state", async () => {
    await expect(loadState("ghost")).rejects.toThrow(/not found/);
  });
});
