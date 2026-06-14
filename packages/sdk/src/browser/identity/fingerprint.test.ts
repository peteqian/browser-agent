import { describe, expect, test } from "bun:test";

import type { CDPClient } from "../../cdp/client";
import { BrowserProfile } from "./profile";
import { enableDomains } from "../session/session-setup";
import {
  buildFingerprintInitScript,
  buildUserAgentOverride,
  resolveFingerprint,
} from "./fingerprint";

describe("resolveFingerprint", () => {
  test("defaults to the macos-chrome preset", () => {
    const fp = resolveFingerprint();
    expect(fp.platform).toBe("MacIntel");
    expect(fp.uaPlatform).toBe("macOS");
    expect(fp.userAgent).toContain("Macintosh");
  });

  test("accepts a preset name", () => {
    const fp = resolveFingerprint("windows-chrome");
    expect(fp.platform).toBe("Win32");
    expect(fp.userAgent).toContain("Windows NT");
  });

  test("merges partial profile over its preset", () => {
    const fp = resolveFingerprint({
      preset: "linux-chrome",
      hardwareConcurrency: 16,
      languages: ["de-DE", "de", "en"],
    });
    expect(fp.platform).toBe("Linux x86_64");
    expect(fp.hardwareConcurrency).toBe(16);
    expect(fp.languages).toEqual(["de-DE", "de", "en"]);
    expect(fp.webglRenderer).toContain("Mesa");
  });

  test("overrides win over both preset and partial", () => {
    const fp = resolveFingerprint(
      { userAgent: "from-partial" },
      { userAgent: "from-profile", acceptLanguage: "fr-FR" },
    );
    expect(fp.userAgent).toBe("from-profile");
    expect(fp.acceptLanguage).toBe("fr-FR");
  });

  test("undefined override fields do not clobber", () => {
    const fp = resolveFingerprint("macos-chrome", { userAgent: undefined });
    expect(fp.userAgent).toContain("Macintosh");
  });

  test("does not leak mutable preset state between calls", () => {
    const a = resolveFingerprint("macos-chrome");
    a.languages.push("xx");
    a.brands[0]!.brand = "mutated";
    const b = resolveFingerprint("macos-chrome");
    expect(b.languages).toEqual(["en-US", "en"]);
    expect(b.brands[0]!.brand).toBe("Google Chrome");
  });
});

describe("buildUserAgentOverride", () => {
  test("mirrors the resolved fingerprint into CDP shape", () => {
    const fp = resolveFingerprint("windows-chrome");
    const override = buildUserAgentOverride(fp);
    expect(override.userAgent).toBe(fp.userAgent);
    expect(override.platform).toBe("Win32");
    expect(override.userAgentMetadata?.platform).toBe("Windows");
    expect(override.userAgentMetadata?.brands).toEqual(fp.brands);
  });
});

describe("buildFingerprintInitScript", () => {
  test("embeds fingerprint values", () => {
    const script = buildFingerprintInitScript(
      resolveFingerprint({ hardwareConcurrency: 4, webglVendor: "Test Vendor Inc." }),
    );
    expect(script).toContain('"hardwareConcurrency", 4');
    expect(script).toContain("Test Vendor Inc.");
    expect(script).toContain('"webdriver", undefined');
  });

  test("omits screen patches unless screen is set", () => {
    const without = buildFingerprintInitScript(resolveFingerprint());
    expect(without).not.toContain("Screen.prototype");
    const withScreen = buildFingerprintInitScript(
      resolveFingerprint({ screen: { width: 1920, height: 1080 } }),
    );
    expect(withScreen).toContain('patch(Screen.prototype, "width", 1920)');
    expect(withScreen).toContain('patch(Screen.prototype, "height", 1080)');
  });
});

interface SendCall {
  method: string;
  params: unknown;
  sessionId: string | undefined;
}

function recordingClient(): { client: CDPClient; calls: SendCall[] } {
  const calls: SendCall[] = [];
  const client = {
    send: async (method: string, params?: unknown, sessionId?: string) => {
      calls.push({ method, params, sessionId });
      return {} as never;
    },
  } as unknown as CDPClient;
  return { client, calls };
}

describe("enableDomains fingerprint wiring", () => {
  test("stealth mode installs init script and UA override from fingerprint", async () => {
    const { client, calls } = recordingClient();
    const profile = new BrowserProfile({ fingerprint: "windows-chrome" });

    await enableDomains(client, "s1", profile, []);

    const scripts = calls
      .filter((c) => c.method === "Page.addScriptToEvaluateOnNewDocument")
      .map((c) => (c.params as { source: string }).source);
    expect(scripts.some((s) => s.includes("__stealthInstalled"))).toBe(true);
    expect(scripts.some((s) => s.includes('"platform", "Win32"'))).toBe(true);

    const ua = calls.find((c) => c.method === "Emulation.setUserAgentOverride");
    expect(ua).toBeDefined();
    expect((ua!.params as { userAgent: string }).userAgent).toContain("Windows NT");
  });

  test("profile.userAgent still wins over fingerprint preset", async () => {
    const { client, calls } = recordingClient();
    const profile = new BrowserProfile({
      fingerprint: "windows-chrome",
      userAgent: "CustomAgent/1.0",
    });

    await enableDomains(client, "s1", profile, []);

    const ua = calls.find((c) => c.method === "Emulation.setUserAgentOverride");
    expect(ua).toBeDefined();
    expect((ua!.params as { userAgent: string }).userAgent).toBe("CustomAgent/1.0");
  });

  test("native mode installs neither script nor override", async () => {
    const { client, calls } = recordingClient();
    const profile = new BrowserProfile({
      fingerprintMode: "native",
      fingerprint: "windows-chrome",
    });

    await enableDomains(client, "s1", profile, []);

    const scripts = calls
      .filter((c) => c.method === "Page.addScriptToEvaluateOnNewDocument")
      .map((c) => (c.params as { source: string }).source);
    expect(scripts.some((s) => s.includes("__stealthInstalled"))).toBe(false);
    expect(calls.find((c) => c.method === "Emulation.setUserAgentOverride")).toBeUndefined();
  });
});
