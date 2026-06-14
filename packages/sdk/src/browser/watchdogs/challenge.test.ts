import { describe, expect, test } from "bun:test";

import type { Page } from "../page";
import {
  ChallengeWatchdog,
  challengeObservationNote,
  detectChallenge,
  type ChallengeDetection,
} from "./challenge";

interface FakePageState {
  /** Detection results returned in order; last one repeats. */
  detections: ChallengeDetection[];
  url?: string;
}

function fakePage(state: FakePageState): {
  page: Page;
  dispatched: Array<Record<string, unknown>>;
} {
  let call = 0;
  const dispatched: Array<Record<string, unknown>> = [];
  const page = {
    session: { profile: {} },
    evaluate: async () => {
      const detection = state.detections[Math.min(call, state.detections.length - 1)]!;
      call += 1;
      return detection;
    },
    currentUrl: async () => state.url ?? "https://example.com/protected",
    sendCDP: async (_method: string, params: Record<string, unknown>) => {
      dispatched.push(params);
      return {};
    },
  } as unknown as Page;
  return { page, dispatched };
}

const none: ChallengeDetection = { vendor: null, clickTarget: null };
const interstitial: ChallengeDetection = { vendor: "cloudflare-interstitial", clickTarget: null };
const turnstile: ChallengeDetection = {
  vendor: "cloudflare-turnstile",
  clickTarget: { x: 120, y: 340 },
};

describe("detectChallenge", () => {
  test("returns clean detection when evaluate fails", async () => {
    const page = {
      evaluate: async () => {
        throw new Error("Execution context was destroyed");
      },
    } as unknown as Page;
    expect(await detectChallenge(page)).toEqual({ vendor: null, clickTarget: null });
  });
});

describe("ChallengeWatchdog", () => {
  test("returns null on a clean page", async () => {
    const { page } = fakePage({ detections: [none] });
    const watchdog = new ChallengeWatchdog({ pollIntervalMs: 1 });
    expect(await watchdog.check(page)).toBeNull();
    expect(watchdog.encounters.length).toBe(0);
  });

  test("waits out an interstitial that auto-passes", async () => {
    const { page } = fakePage({ detections: [interstitial, interstitial, none] });
    const watchdog = new ChallengeWatchdog({ pollIntervalMs: 1, timeoutMs: 500 });
    const encounter = await watchdog.check(page);
    expect(encounter).toMatchObject({
      vendor: "cloudflare-interstitial",
      resolved: true,
      action: "waited",
    });
    expect(watchdog.encounters).toHaveLength(1);
  });

  test("clicks an interactive turnstile after the grace period", async () => {
    const { page, dispatched } = fakePage({
      detections: [turnstile, turnstile, turnstile, none],
    });
    const watchdog = new ChallengeWatchdog({
      pollIntervalMs: 1,
      timeoutMs: 500,
      clickGraceMs: 0,
    });
    const encounter = await watchdog.check(page);
    expect(encounter).toMatchObject({
      vendor: "cloudflare-turnstile",
      resolved: true,
      action: "clicked",
    });
    const press = dispatched.find((p) => p.type === "mousePressed");
    expect(press).toMatchObject({ x: 120, y: 340 });
    // Humanized path: multiple mouseMoved events precede the press.
    expect(dispatched.filter((p) => p.type === "mouseMoved").length).toBeGreaterThanOrEqual(6);
  });

  test("clickTurnstile=false never clicks", async () => {
    const { page, dispatched } = fakePage({ detections: [turnstile, turnstile, none] });
    const watchdog = new ChallengeWatchdog({
      pollIntervalMs: 1,
      timeoutMs: 200,
      clickGraceMs: 0,
      clickTurnstile: false,
    });
    const encounter = await watchdog.check(page);
    expect(encounter?.action).toBe("waited");
    expect(dispatched.length).toBe(0);
  });

  test("times out, records unresolved, and short-circuits on the next check", async () => {
    const { page } = fakePage({ detections: [interstitial] });
    const watchdog = new ChallengeWatchdog({ pollIntervalMs: 1, timeoutMs: 20 });

    const first = await watchdog.check(page);
    expect(first).toMatchObject({ resolved: false, action: "waited" });

    const second = await watchdog.check(page);
    expect(second).toMatchObject({ resolved: false, action: "none", durationMs: 0 });
    expect(watchdog.encounters).toHaveLength(2);
  });

  test("non-cloudflare captchas only get a short wait", async () => {
    const recaptcha: ChallengeDetection = { vendor: "recaptcha", clickTarget: null };
    const { page } = fakePage({ detections: [recaptcha] });
    const watchdog = new ChallengeWatchdog({ pollIntervalMs: 5, timeoutMs: 60_000 });
    const startedAt = Date.now();
    const encounter = await watchdog.check(page);
    expect(encounter).toMatchObject({ vendor: "recaptcha", resolved: false });
    expect(Date.now() - startedAt).toBeLessThan(10_000);
  }, 15_000);
});

describe("challengeObservationNote", () => {
  test("names the vendor and warns against retry loops", () => {
    const note = challengeObservationNote({
      vendor: "cloudflare-turnstile",
      url: "https://example.com",
      resolved: false,
      action: "clicked",
      durationMs: 20_000,
      detectedAt: new Date().toISOString(),
    });
    expect(note).toContain("Turnstile");
    expect(note).toContain("Do not retry");
  });
});

describe("ChallengeWatchdog solver", () => {
  // detect stays dirty until `clearOnInject` fires from the injection script,
  // so the wait loop times out and the solver path is exercised.
  function solverPage(opts: { clearOnInject: boolean }): { page: Page; evals: string[] } {
    const evals: string[] = [];
    let injected = false;
    const recaptcha: ChallengeDetection = { vendor: "recaptcha", clickTarget: null };
    const page = {
      session: { profile: {} },
      currentUrl: async () => "https://example.com/gate",
      sendCDP: async () => ({}),
      evaluate: async (script: string) => {
        // DETECT script — the only one referencing recaptcha/hcaptcha bframe selectors.
        if (script.includes("recaptcha/api2/bframe") || script.includes("hcaptcha.com")) {
          return injected && opts.clearOnInject ? none : recaptcha;
        }
        evals.push(script);
        if (script.includes("data-sitekey")) return "site-123";
        if (script.includes("token")) {
          injected = true;
          return true;
        }
        return null;
      },
    } as unknown as Page;
    return { page, evals };
  }

  test("invokes solver after wait fails and resolves on token injection", async () => {
    const { page, evals } = solverPage({ clearOnInject: true });
    const calls: Array<{ vendor: string; siteKey?: string }> = [];
    const solver = {
      solve: async (req: { vendor: string; siteKey?: string }) => {
        calls.push(req);
        return { solved: true, token: "TOKEN-ABC" };
      },
    };
    const watchdog = new ChallengeWatchdog({ pollIntervalMs: 1, timeoutMs: 20, solver });
    const encounter = await watchdog.check(page);
    expect(encounter).toMatchObject({ vendor: "recaptcha", resolved: true, action: "solved" });
    expect(calls[0]).toMatchObject({ vendor: "recaptcha", siteKey: "site-123" });
    expect(evals.some((s) => s.includes("TOKEN-ABC"))).toBe(true);
  });

  test("solver that fails leaves the challenge unresolved", async () => {
    const { page } = solverPage({ clearOnInject: false });
    const solver = { solve: async () => ({ solved: false }) };
    const watchdog = new ChallengeWatchdog({ pollIntervalMs: 1, timeoutMs: 20, solver });
    const encounter = await watchdog.check(page);
    expect(encounter).toMatchObject({ resolved: false });
    expect(encounter?.action).not.toBe("solved");
  });
});
