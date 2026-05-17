import { describe, expect, test } from "bun:test";

import { AUTO_CONSENT_INIT_SCRIPT, AUTO_CONSENT_SELECTORS } from "./auto-consent";

describe("auto-consent", () => {
  test("selector list non-empty and unique", () => {
    expect(AUTO_CONSENT_SELECTORS.length).toBeGreaterThan(5);
    expect(new Set(AUTO_CONSENT_SELECTORS).size).toBe(AUTO_CONSENT_SELECTORS.length);
  });

  test("init script embeds selectors as JSON", () => {
    expect(AUTO_CONSENT_INIT_SCRIPT).toContain("#onetrust-accept-btn-handler");
    expect(AUTO_CONSENT_INIT_SCRIPT).toContain("__autoConsentInstalled");
    expect(AUTO_CONSENT_INIT_SCRIPT).toContain(JSON.stringify(AUTO_CONSENT_SELECTORS));
  });

  test("script idempotency guard against double install", () => {
    expect(AUTO_CONSENT_INIT_SCRIPT).toMatch(/if \(window\.__autoConsentInstalled\) return/);
  });
});
