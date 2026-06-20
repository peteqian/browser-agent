import { describe, expect, test } from "bun:test";

import { spawnChildWithSignal } from "./spawnChild";

describe("spawnChildWithSignal", () => {
  test("returns stdout and exitCode 0 on success", async () => {
    const result = await spawnChildWithSignal({
      bin: "node",
      args: ["-e", "process.stdout.write('hello')"],
      label: "test",
    });
    expect(result.stdout).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
  });

  test("captures stderr on non-zero exit without throwing", async () => {
    const result = await spawnChildWithSignal({
      bin: "node",
      args: ["-e", "process.stderr.write('boom'); process.exit(3)"],
      label: "test",
    });
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("boom");
    expect(result.exitCode).toBe(3);
  });

  test("writes stdin and child receives it", async () => {
    const result = await spawnChildWithSignal({
      bin: "node",
      args: [
        "-e",
        "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(d.toUpperCase()))",
      ],
      stdin: "abc",
      label: "test",
    });
    expect(result.stdout).toBe("ABC");
  });

  test("throws synchronously when signal already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      spawnChildWithSignal({
        bin: "node",
        args: ["-e", "1"],
        label: "test",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/test aborted before spawn/);
  });

  test("throws when signal aborts during run", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 50);
    await expect(
      spawnChildWithSignal({
        bin: "node",
        args: ["-e", "setTimeout(()=>{}, 5000)"],
        label: "test",
        signal: controller.signal,
      }),
    ).rejects.toThrow(/test aborted/);
  });

  test("respects custom env", async () => {
    const result = await spawnChildWithSignal({
      bin: "node",
      args: ["-e", "process.stdout.write(process.env.SPAWN_CHILD_TEST || 'unset')"],
      env: { ...process.env, SPAWN_CHILD_TEST: "from-test" },
      label: "test",
    });
    expect(result.stdout).toBe("from-test");
  });

  test("respects custom cwd", async () => {
    const result = await spawnChildWithSignal({
      bin: "node",
      args: ["-e", "process.stdout.write(process.cwd())"],
      cwd: "/tmp",
      label: "test",
    });
    // macOS resolves /tmp → /private/tmp; accept either spelling.
    expect(result.stdout.endsWith("/tmp")).toBe(true);
  });
});
