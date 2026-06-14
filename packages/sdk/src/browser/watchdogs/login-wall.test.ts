import { describe, expect, test } from "bun:test";

import type { Page } from "../page/page";
import {
  LoginWallWatchdog,
  detectLoginWall,
  loginWallObservationNote,
  type LoginWallDetection,
} from "./login-wall";

function fakePage(detection: LoginWallDetection | (() => LoginWallDetection), url?: string): Page {
  return {
    evaluate: async () => (typeof detection === "function" ? detection() : detection),
    currentUrl: async () => url ?? "https://example.com/jobs/apply",
  } as unknown as Page;
}

const clean: LoginWallDetection = { detected: false, signals: [] };
const passwordWall: LoginWallDetection = { detected: true, signals: ["password_form"] };
const loginRedirect: LoginWallDetection = {
  detected: true,
  signals: ["password_form", "login_url"],
};

describe("detectLoginWall", () => {
  test("returns clean detection when evaluate fails", async () => {
    const page = {
      evaluate: async () => {
        throw new Error("Execution context was destroyed");
      },
    } as unknown as Page;
    expect(await detectLoginWall(page)).toEqual({ detected: false, signals: [] });
  });

  test("returns clean detection for malformed payloads", async () => {
    const page = { evaluate: async () => "nonsense" } as unknown as Page;
    expect(await detectLoginWall(page)).toEqual({ detected: false, signals: [] });
  });
});

describe("LoginWallWatchdog", () => {
  test("returns null on a clean page", async () => {
    const watchdog = new LoginWallWatchdog();
    expect(await watchdog.check(fakePage(clean))).toBeNull();
    expect(watchdog.encounters.length).toBe(0);
  });

  test("reports a password-form login wall with its signals", async () => {
    const watchdog = new LoginWallWatchdog();
    const encounter = await watchdog.check(
      fakePage(loginRedirect, "https://example.com/login?next=%2Fapply"),
    );
    expect(encounter).toMatchObject({
      url: "https://example.com/login?next=%2Fapply",
      signals: ["password_form", "login_url"],
      firstSighting: true,
    });
    expect(watchdog.encounters).toHaveLength(1);
  });

  test("marks repeat sightings of the same URL as not first", async () => {
    const watchdog = new LoginWallWatchdog();
    const page = fakePage(passwordWall, "https://example.com/login");
    const first = await watchdog.check(page);
    const second = await watchdog.check(page);
    expect(first?.firstSighting).toBe(true);
    expect(second?.firstSighting).toBe(false);
    expect(watchdog.encounters).toHaveLength(2);
  });

  test("different URLs each count as a first sighting", async () => {
    const watchdog = new LoginWallWatchdog();
    const a = await watchdog.check(fakePage(passwordWall, "https://a.example.com/login"));
    const b = await watchdog.check(fakePage(passwordWall, "https://b.example.com/signin"));
    expect(a?.firstSighting).toBe(true);
    expect(b?.firstSighting).toBe(true);
  });
});

describe("loginWallObservationNote", () => {
  test("names the detected signals and forbids guessing credentials", () => {
    const note = loginWallObservationNote({
      url: "https://example.com/login",
      signals: ["password_form", "http_unauthorized"],
      firstSighting: true,
      detectedAt: new Date().toISOString(),
    });
    expect(note).toContain("LOGIN WALL");
    expect(note).toContain("sign-in form with a password field");
    expect(note).toContain("401/403");
    expect(note).toContain("Do not guess");
  });
});
