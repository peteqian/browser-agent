import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveProfilePaths } from "../profiles";
import { runProfileCommand } from "./profile";

describe("runProfileCommand", () => {
  test("lists profiles as JSON", async () => {
    const home = temporaryHome();
    try {
      makeProfile("booking");
      const output = await captureStdout(() => runProfileCommand(["list", "--json"]));
      const parsed = JSON.parse(output.text) as { profiles: Array<{ name: string }> };

      expect(output.code).toBe(0);
      expect(parsed.profiles.map((profile) => profile.name)).toEqual(["booking"]);
    } finally {
      home.dispose();
    }
  });

  test("shows a profile and returns non-zero for a missing profile", async () => {
    const home = temporaryHome();
    try {
      makeProfile("booking");
      const existing = await captureStdout(() => runProfileCommand(["show", "booking", "--json"]));
      const missing = await captureStdout(() => runProfileCommand(["show", "missing", "--json"]));

      expect(existing.code).toBe(0);
      expect(JSON.parse(existing.text).exists).toBe(true);
      expect(missing.code).toBe(1);
      expect(JSON.parse(missing.text).exists).toBe(false);
    } finally {
      home.dispose();
    }
  });

  test("clears one profile without removing siblings", async () => {
    const home = temporaryHome();
    try {
      makeProfile("booking");
      makeProfile("keep");

      const cleared = await captureStdout(() => runProfileCommand(["clear", "booking", "--json"]));
      const list = await captureStdout(() => runProfileCommand(["list", "--json"]));

      expect(cleared.code).toBe(0);
      expect(JSON.parse(cleared.text).exists).toBe(false);
      expect(
        JSON.parse(list.text).profiles.map((profile: { name: string }) => profile.name),
      ).toEqual(["keep"]);
    } finally {
      home.dispose();
    }
  });
});

function makeProfile(name: string): void {
  const paths = resolveProfilePaths(name);
  mkdirSync(paths.userDataDir, { recursive: true });
  writeFileSync(paths.storageStatePath, "{}\n");
}

async function captureStdout(run: () => Promise<number>): Promise<{ code: number; text: string }> {
  const original = process.stdout.write;
  let text = "";
  process.stdout.write = ((chunk: string | Uint8Array) => {
    text += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    return true;
  }) as typeof process.stdout.write;
  try {
    const code = await run();
    return { code, text };
  } finally {
    process.stdout.write = original;
  }
}

function temporaryHome() {
  const oldHome = process.env.BROWSER_AGENT_HOME;
  const path = mkdtempSync(join(tmpdir(), "browser-agent-profile-command-"));
  process.env.BROWSER_AGENT_HOME = path;
  return {
    path,
    dispose() {
      if (oldHome === undefined) {
        delete process.env.BROWSER_AGENT_HOME;
      } else {
        process.env.BROWSER_AGENT_HOME = oldHome;
      }
      rmSync(path, { recursive: true, force: true });
    },
  };
}
