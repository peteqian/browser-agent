import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "../page";
import { humanClickAtCoordinates } from "../page-input";

/**
 * Bot-protection challenge watchdog.
 *
 * Detects Cloudflare interstitials, Turnstile widgets, reCAPTCHA and hCaptcha
 * from DOM markers, then handles what is automatable: managed/JS challenges
 * usually clear on their own (we wait), interactive Turnstile checkboxes get a
 * humanized click after a grace period. CAPTCHAs that need a real solve are
 * reported, not solved — the agent loop surfaces them in the observation so
 * the model can route around them (or a human can intervene on a headed
 * browser).
 */

export type ChallengeVendor =
  | "cloudflare-interstitial"
  | "cloudflare-turnstile"
  | "recaptcha"
  | "hcaptcha";

export interface ChallengeDetection {
  vendor: ChallengeVendor | null;
  /** Viewport coordinates of a clickable widget (Turnstile checkbox). */
  clickTarget: { x: number; y: number } | null;
}

export interface ChallengeEncounter {
  vendor: ChallengeVendor;
  url: string;
  /** True when the challenge cleared while the watchdog was handling it. */
  resolved: boolean;
  /** What the watchdog did: waited for auto-pass, clicked the widget, called a solver, or nothing (known-stuck challenge). */
  action: "waited" | "clicked" | "solved" | "none";
  durationMs: number;
  detectedAt: string;
}

/** What a {@link CaptchaSolver} is asked to solve. */
export interface CaptchaSolveRequest {
  vendor: ChallengeVendor;
  url: string;
  /** Site key parsed from the widget DOM, when present (reCAPTCHA/hCaptcha/Turnstile). */
  siteKey?: string;
}

export interface CaptchaSolveResult {
  solved: boolean;
  /**
   * Solved token to inject into the page (reCAPTCHA `g-recaptcha-response`,
   * hCaptcha `h-captcha-response`, Turnstile `cf-turnstile-response`). Omit
   * when the solver resolved the challenge out-of-band (e.g. a human handoff
   * that interacted with the live widget directly).
   */
  token?: string;
}

/**
 * Pluggable solver for challenges the watchdog can't clear on its own.
 * Implement with a third-party service (2captcha, CapSolver, Anti-Captcha)
 * or a manual human-handoff. The watchdog calls it once, after auto-pass and
 * the Turnstile click have failed, and injects any returned token.
 */
export interface CaptchaSolver {
  solve(request: CaptchaSolveRequest): Promise<CaptchaSolveResult>;
}

export interface ChallengeWatchdogOptions {
  /** Max total time to wait for a challenge to clear. Default: 20000. */
  timeoutMs?: number;
  /** Detection poll interval while waiting. Default: 500. */
  pollIntervalMs?: number;
  /**
   * Grace period before clicking an interactive Turnstile checkbox, giving
   * the non-interactive auto-pass a chance first. Default: 2500.
   */
  clickGraceMs?: number;
  /** Humanized click on interactive Turnstile checkboxes. Default: true. */
  clickTurnstile?: boolean;
  /**
   * Optional solver invoked as a last resort for reCAPTCHA / hCaptcha /
   * Turnstile that auto-pass and clicking didn't clear. Default: none.
   */
  solver?: CaptchaSolver;
}

const SITE_KEY_SCRIPT = `(() => {
  const el = document.querySelector('[data-sitekey], .g-recaptcha[data-sitekey], .h-captcha[data-sitekey], .cf-turnstile[data-sitekey]');
  return el ? el.getAttribute('data-sitekey') : null;
})()`;

function tokenInjectionScript(vendor: ChallengeVendor, token: string): string {
  const fields: Record<ChallengeVendor, string[]> = {
    recaptcha: ["g-recaptcha-response"],
    hcaptcha: ["h-captcha-response"],
    "cloudflare-turnstile": ["cf-turnstile-response"],
    "cloudflare-interstitial": ["cf-turnstile-response"],
  };
  const names = JSON.stringify(fields[vendor]);
  const json = JSON.stringify(token);
  return `(() => {
    const token = ${json};
    for (const name of ${names}) {
      let field = document.querySelector('textarea[name="' + name + '"], input[name="' + name + '"]');
      if (!field) {
        field = document.createElement('textarea');
        field.name = name;
        field.style.display = 'none';
        document.body.appendChild(field);
      }
      field.value = token;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`;
}

const DETECT_CHALLENGE_SCRIPT = `(() => {
  const result = { vendor: null, clickTarget: null };
  const centerOf = (el) => {
    if (!el) return null;
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) return null;
    // Turnstile draws its checkbox ~28px from the widget's left edge.
    return { x: b.left + Math.min(28, b.width / 2), y: b.top + b.height / 2 };
  };
  const turnstileFrame = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
  const interstitialMarker = document.querySelector(
    '#challenge-running, #challenge-stage, #challenge-form, #cf-challenge-running, .cf-browser-verification, #cf-please-wait, .ray-id'
  );
  const interstitialTitle = /just a moment|attention required|checking your browser|verify you are human|ddos protection/i.test(document.title || "");
  if (interstitialMarker || (interstitialTitle && (turnstileFrame || document.querySelector('script[src*="cdn-cgi/challenge-platform"]')))) {
    result.vendor = "cloudflare-interstitial";
    result.clickTarget = centerOf(turnstileFrame || document.querySelector('#challenge-stage, .ctp-checkbox-label'));
    return result;
  }
  if (turnstileFrame || document.querySelector('.cf-turnstile, input[name="cf-turnstile-response"]')) {
    result.vendor = "cloudflare-turnstile";
    result.clickTarget = centerOf(turnstileFrame || document.querySelector('.cf-turnstile'));
    return result;
  }
  if (document.querySelector('iframe[src*="/recaptcha/api2/bframe"], iframe[src*="/recaptcha/enterprise/bframe"]')) {
    result.vendor = "recaptcha";
    return result;
  }
  if (document.querySelector('iframe[src*="hcaptcha.com"][src*="frame=challenge"], .h-captcha iframe[data-hcaptcha-response=""]')) {
    result.vendor = "hcaptcha";
    return result;
  }
  return result;
})()`;

/** Detection must never wedge the loop on a hung/destroyed page. */
const DETECT_TIMEOUT_MS = 2_000;

export async function detectChallenge(page: Page): Promise<ChallengeDetection> {
  const detected = await withTimeout(
    page.evaluate<ChallengeDetection>(DETECT_CHALLENGE_SCRIPT).catch(() => null),
    DETECT_TIMEOUT_MS,
  );
  if (!detected || typeof detected !== "object" || !detected.vendor) {
    return { vendor: null, clickTarget: null };
  }
  return { vendor: detected.vendor, clickTarget: detected.clickTarget ?? null };
}

function withTimeout<T>(promise: Promise<T | null>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

export class ChallengeWatchdog {
  readonly encounters: ChallengeEncounter[] = [];
  private readonly timeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly clickGraceMs: number;
  private readonly clickTurnstile: boolean;
  private readonly solver?: CaptchaSolver;
  /** vendor|url pairs we already waited on and failed — don't block again. */
  private readonly stuck = new Set<string>();

  constructor(options: ChallengeWatchdogOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 20_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 500;
    this.clickGraceMs = options.clickGraceMs ?? 2_500;
    this.clickTurnstile = options.clickTurnstile ?? true;
    this.solver = options.solver;
  }

  /**
   * Detect and, when possible, clear a challenge on `page`. Returns the
   * encounter when a challenge was present, null when the page is clean.
   * A challenge that already failed once for the same vendor+URL is reported
   * immediately (action "none") instead of blocking the loop again.
   */
  async check(page: Page): Promise<ChallengeEncounter | null> {
    const first = await detectChallenge(page);
    if (!first.vendor) return null;

    const url = await page.currentUrl().catch(() => "");
    const detectedAt = new Date().toISOString();
    const stuckKey = `${first.vendor}|${url}`;
    if (this.stuck.has(stuckKey)) {
      const encounter: ChallengeEncounter = {
        vendor: first.vendor,
        url,
        resolved: false,
        action: "none",
        durationMs: 0,
        detectedAt,
      };
      this.encounters.push(encounter);
      return encounter;
    }

    const startedAt = Date.now();
    const isCloudflare =
      first.vendor === "cloudflare-interstitial" || first.vendor === "cloudflare-turnstile";
    // Non-automatable CAPTCHAs get one short wait (an invisible pass may still
    // land); Cloudflare gets the full budget since auto-pass is the norm.
    const deadline = startedAt + (isCloudflare ? this.timeoutMs : Math.min(this.timeoutMs, 5_000));
    let action: ChallengeEncounter["action"] = "waited";
    let clicked = false;

    while (Date.now() < deadline) {
      await delay(this.pollIntervalMs);
      const current = await detectChallenge(page);
      if (!current.vendor) {
        const encounter: ChallengeEncounter = {
          vendor: first.vendor,
          url,
          resolved: true,
          action,
          durationMs: Date.now() - startedAt,
          detectedAt,
        };
        this.encounters.push(encounter);
        return encounter;
      }
      const canClick =
        this.clickTurnstile &&
        !clicked &&
        isCloudflare &&
        current.clickTarget !== null &&
        Date.now() - startedAt >= this.clickGraceMs;
      if (canClick && current.clickTarget) {
        await humanClickAtCoordinates(page, current.clickTarget.x, current.clickTarget.y).catch(
          () => {},
        );
        clicked = true;
        action = "clicked";
      }
    }

    // Last resort: hand off to a configured solver.
    if (this.solver) {
      const solved = await this.trySolver(page, first.vendor, url).catch(() => false);
      if (solved) {
        const encounter: ChallengeEncounter = {
          vendor: first.vendor,
          url,
          resolved: true,
          action: "solved",
          durationMs: Date.now() - startedAt,
          detectedAt,
        };
        this.encounters.push(encounter);
        return encounter;
      }
    }

    this.stuck.add(stuckKey);
    const encounter: ChallengeEncounter = {
      vendor: first.vendor,
      url,
      resolved: false,
      action,
      durationMs: Date.now() - startedAt,
      detectedAt,
    };
    this.encounters.push(encounter);
    return encounter;
  }

  /**
   * Invoke the configured solver, inject any returned token, and confirm the
   * challenge cleared. Returns true only when the page is challenge-free
   * afterward.
   */
  private async trySolver(page: Page, vendor: ChallengeVendor, url: string): Promise<boolean> {
    if (!this.solver) return false;
    const siteKey =
      (await page.evaluate<string | null>(SITE_KEY_SCRIPT).catch(() => null)) ?? undefined;
    const result = await this.solver.solve({ vendor, url, ...(siteKey ? { siteKey } : {}) });
    if (!result.solved) return false;
    if (result.token) {
      await page.evaluate(tokenInjectionScript(vendor, result.token)).catch(() => {});
    }
    // Give the page a beat to validate the injected token, then re-detect.
    await delay(this.pollIntervalMs);
    const after = await detectChallenge(page);
    return after.vendor === null;
  }
}

/** One-line observation note so the model knows a challenge blocks the page. */
export function challengeObservationNote(encounter: ChallengeEncounter): string {
  const vendorLabel: Record<ChallengeVendor, string> = {
    "cloudflare-interstitial": "a Cloudflare browser-verification interstitial",
    "cloudflare-turnstile": "a Cloudflare Turnstile widget",
    recaptcha: "a reCAPTCHA challenge",
    hcaptcha: "an hCaptcha challenge",
  };
  return (
    `CHALLENGE: this page is gated by ${vendorLabel[encounter.vendor]} that did not clear ` +
    `automatically (waited ${Math.round(encounter.durationMs / 1000)}s). Do not retry the same ` +
    `navigation in a loop. Consider an alternative path (different page, search engine cache, ` +
    `or the site's other entry points), or finish with what you have.`
  );
}
