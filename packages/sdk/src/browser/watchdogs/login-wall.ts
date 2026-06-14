import type { Page } from "../page";

/**
 * Login-wall watchdog.
 *
 * Detects pages that gate content behind authentication: a visible password
 * form with sign-in copy, a login-style URL path (redirect to /login,
 * /signin, SSO entry points), or a bare 401/403 error document. Unlike the
 * challenge watchdog there is nothing to automate here — the watchdog only
 * reports, so the agent loop can surface a structured `login_wall` event
 * (callers can pause for a human, like the CAPTCHA path) and an observation
 * note so the model routes around the wall instead of looping on it.
 */

export type LoginWallSignal = "password_form" | "login_url" | "http_unauthorized";

export interface LoginWallDetection {
  detected: boolean;
  signals: LoginWallSignal[];
}

export interface LoginWallEncounter {
  url: string;
  signals: LoginWallSignal[];
  /** False when the same URL was already reported earlier in the run. */
  firstSighting: boolean;
  detectedAt: string;
}

const DETECT_LOGIN_WALL_SCRIPT = `(() => {
  const signals = [];
  const visible = (el) => {
    if (!el) return false;
    const b = el.getBoundingClientRect();
    return b.width > 0 && b.height > 0;
  };
  const password = Array.from(document.querySelectorAll('input[type="password"]')).find(visible);
  if (password) {
    const scope = password.closest("form") || document.body;
    const copy = ((scope && scope.innerText) || "").slice(0, 3000);
    if (/\\b(sign[ -]?in|log[ -]?in|welcome back|continue with|forgot (your )?password|enter your password|email or username)\\b/i.test(copy)) {
      signals.push("password_form");
    }
  }
  if (/(^|\\/)(login|log-in|signin|sign-in|sign_in|sso|auth|authenticate|users\\/sign_in|account\\/login)(\\/|$)/i.test(location.pathname)) {
    signals.push("login_url");
  }
  const title = document.title || "";
  const bodyText = (document.body && document.body.innerText) || "";
  if (
    /\\b(401|403)\\b|unauthorized|forbidden/i.test(title) &&
    bodyText.trim().length < 600
  ) {
    signals.push("http_unauthorized");
  }
  return { detected: signals.length > 0, signals };
})()`;

/** Detection must never wedge the loop on a hung/destroyed page. */
const DETECT_TIMEOUT_MS = 2_000;

export async function detectLoginWall(page: Page): Promise<LoginWallDetection> {
  const detected = await withTimeout(
    page.evaluate<LoginWallDetection>(DETECT_LOGIN_WALL_SCRIPT).catch(() => null),
    DETECT_TIMEOUT_MS,
  );
  if (!detected || typeof detected !== "object" || !Array.isArray(detected.signals)) {
    return { detected: false, signals: [] };
  }
  return { detected: detected.detected === true, signals: detected.signals };
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

export class LoginWallWatchdog {
  readonly encounters: LoginWallEncounter[] = [];
  /** URLs already reported — later sightings carry firstSighting: false. */
  private readonly seen = new Set<string>();

  /**
   * Detect a login wall on `page`. Returns the encounter when one is
   * present, null when the page is clean. Detection is read-only; there is
   * no waiting or clicking to attempt.
   */
  async check(page: Page): Promise<LoginWallEncounter | null> {
    const detection = await detectLoginWall(page);
    if (!detection.detected) return null;

    const url = await page.currentUrl().catch(() => "");
    const firstSighting = !this.seen.has(url);
    this.seen.add(url);
    const encounter: LoginWallEncounter = {
      url,
      signals: detection.signals,
      firstSighting,
      detectedAt: new Date().toISOString(),
    };
    this.encounters.push(encounter);
    return encounter;
  }
}

/** One-line observation note so the model knows the page needs auth. */
export function loginWallObservationNote(encounter: LoginWallEncounter): string {
  const signalLabel: Record<LoginWallSignal, string> = {
    password_form: "a sign-in form with a password field",
    login_url: "a login-page URL",
    http_unauthorized: "an HTTP 401/403 error document",
  };
  const detected = encounter.signals.map((signal) => signalLabel[signal]).join(", ");
  return (
    `LOGIN WALL: this page requires authentication (detected: ${detected}). ` +
    `Do not guess or invent credentials. If the task provided credentials (e.g. via ` +
    `<secret> placeholders), sign in with them; otherwise continue without this page — ` +
    `use an alternative public path, or finish and report that a human sign-in is needed.`
  );
}
