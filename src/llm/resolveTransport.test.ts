import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { resolveTransport } from "./resolveTransport";
import type { TransportResolution } from "../agent/contracts";

const ENV_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "CODEX_BIN",
  "CLAUDE_BIN",
  "HOME",
  "BROWSER_AGENT_ENV",
  "KUBERNETES_SERVICE_HOST",
  "AWS_LAMBDA_FUNCTION_NAME",
  "VERCEL",
  "FLY_APP_NAME",
  "RAILWAY_ENVIRONMENT",
  "GOOGLE_CLOUD_PROJECT",
  "K_SERVICE",
];

let originalStderrWrite: typeof process.stderr.write;

describe("resolveTransport", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = {};
    for (const key of ENV_VARS) {
      saved[key] = process.env[key];
      delete process.env[key];
    }
    // Silence the "transport_resolved" / "transport_unavailable" stderr logs
    // emitted on every resolve.
    originalStderrWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = (() => true) as typeof process.stderr.write;
  });

  afterEach(() => {
    for (const key of ENV_VARS) {
      if (saved[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved[key];
      }
    }
    process.stderr.write = originalStderrWrite;
  });

  test("openai with API key resolves to sdk-api", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    const { resolution } = resolveTransport({ provider: "openai", model: "gpt-4" });
    expect(resolution.transport).toBe("sdk-api");
    expect(resolution.provider).toBe("openai");
    expect(resolution.env).toBe("local");
    expect(resolution.durationMs).toBeGreaterThanOrEqual(0);
    expect(resolution.fallbackFrom).toBeUndefined();
  });

  test("openai with explicit API key resolves to sdk-api", () => {
    const { resolution } = resolveTransport({
      provider: "openai",
      model: "gpt-4",
      apiKey: "sk-from-options",
    });
    expect(resolution.transport).toBe("sdk-api");
  });

  test("openai without API key throws", () => {
    expect(() => resolveTransport({ provider: "openai", model: "gpt-4" })).toThrow(
      /No transport available/,
    );
  });

  test("anthropic with API key resolves to sdk-api", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    const { resolution } = resolveTransport({ provider: "anthropic", model: "claude-x" });
    expect(resolution.transport).toBe("sdk-api");
  });

  test("anthropic with explicit API key resolves to sdk-api", () => {
    const { resolution } = resolveTransport({
      provider: "anthropic",
      model: "claude-x",
      apiKey: "sk-ant-from-options",
    });
    expect(resolution.transport).toBe("sdk-api");
  });

  test("cloud env forces sdk-api for claude (no fallback to cli/sdk-agent)", () => {
    process.env.BROWSER_AGENT_ENV = "cloud";
    process.env.ANTHROPIC_API_KEY = "sk-ant";
    const { resolution } = resolveTransport({ provider: "claude", model: "claude-x" });
    expect(resolution.transport).toBe("sdk-api");
    expect(resolution.env).toBe("cloud");
  });

  test("cloud env disallows codex (no cloud-safe transport)", () => {
    process.env.BROWSER_AGENT_ENV = "cloud";
    process.env.OPENAI_API_KEY = "sk-test";
    const { resolution } = resolveTransport({ provider: "codex", model: "gpt-5" });
    expect(resolution.transport).toBe("sdk-api");
    expect(resolution.env).toBe("cloud");
  });

  test("codex falls back to sdk-api when local transports are unavailable and OPENAI_API_KEY is set", () => {
    process.env.HOME = "/tmp/browser-agent-no-codex-auth";
    process.env.CODEX_BIN = "definitely-missing-codex-bin";
    process.env.OPENAI_API_KEY = "sk-test";
    const { resolution } = resolveTransport({ provider: "codex", model: "gpt-5" });
    expect(resolution.transport).toBe("sdk-api");
    expect(resolution.fallbackFrom).toBe("sdk-agent");
  });

  test("forced transport=sdk-api skips fallback chain", () => {
    process.env.OPENAI_API_KEY = "sk";
    const { resolution } = resolveTransport({
      provider: "openai",
      model: "gpt-4",
      transport: "sdk-api",
    });
    expect(resolution.transport).toBe("sdk-api");
  });

  test("forced transport=cli for codex when CODEX_BIN is set", () => {
    // Use `node` as a stand-in binary that's guaranteed to exist on PATH
    // in any CI worker — we only need probeCli's `which` check to pass.
    process.env.CODEX_BIN = "node";
    process.env.OPENAI_API_KEY = "sk";
    const { resolution } = resolveTransport({
      provider: "codex",
      model: "gpt-5",
      transport: "cli",
    });
    expect(resolution.transport).toBe("cli");
    delete process.env.CODEX_BIN;
  });

  test("forced unsupported transport throws", () => {
    expect(() =>
      resolveTransport({
        provider: "openai",
        model: "gpt-4",
        transport: "cli",
      }),
    ).toThrow(/No transport available/);
  });

  test("explicit env=cloud overrides BROWSER_AGENT_ENV", () => {
    process.env.BROWSER_AGENT_ENV = "local";
    process.env.OPENAI_API_KEY = "sk";
    const { resolution } = resolveTransport({
      provider: "openai",
      model: "gpt-4",
      env: "cloud",
    });
    expect(resolution.env).toBe("cloud");
  });

  test("onResolve callback fires with final resolution", () => {
    process.env.OPENAI_API_KEY = "sk";
    const captured: TransportResolution[] = [];
    resolveTransport({
      provider: "openai",
      model: "gpt-4",
      onResolve: (r) => captured.push(r),
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.transport).toBe("sdk-api");
  });

  test("onResolve errors do not break resolution", () => {
    process.env.OPENAI_API_KEY = "sk";
    const result = resolveTransport({
      provider: "openai",
      model: "gpt-4",
      onResolve: () => {
        throw new Error("consumer-side bug");
      },
    });
    expect(result.resolution.transport).toBe("sdk-api");
  });

  test("returns a callable decide function", () => {
    process.env.OPENAI_API_KEY = "sk";
    const { decide } = resolveTransport({ provider: "openai", model: "gpt-4" });
    expect(typeof decide).toBe("function");
  });
});
