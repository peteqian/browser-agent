/**
 * Init script injected via Page.addScriptToEvaluateOnNewDocument when
 * BrowserProfile.autoConsent is enabled. Polls for known consent-management
 * platform (CMP) buttons and clicks them once visible. Idempotent — each
 * selector clicks at most once per document.
 *
 * Sites covered (curated, drift-tested 2026-05):
 * - OneTrust              booking.com, ft.com, theguardian.com, ...
 * - Cookiebot             many SMB / EU sites
 * - Didomi                lemonde.fr, lesechos.fr, ...
 * - TrustArc              IBM, Cisco, ...
 * - Usercentrics          n-tv.de, prosieben.de, ...
 * - Quantcast Choice      forbes.com, ...
 * - Generic [aria-label*="cookie" i] accept button as fallback
 *
 * Conservative on purpose: every click is a CSS-selector match. We do NOT
 * walk all visible buttons matching "accept" text — that risks clicking
 * the wrong button on payment forms, etc.
 */
export const AUTO_CONSENT_SELECTORS: readonly string[] = [
  // OneTrust
  "#onetrust-accept-btn-handler",
  "#accept-recommended-btn-handler",
  // Cookiebot
  "#CybotCookiebotDialogBodyButtonAccept",
  "#CybotCookiebotDialogBodyLevelButtonAcceptAll",
  "#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll",
  // Didomi
  "#didomi-notice-agree-button",
  // TrustArc
  "#truste-consent-button",
  ".trustarc-agree-btn",
  // Usercentrics
  "[data-testid='uc-accept-all-button']",
  "button[data-testid='uc-accept-all-button']",
  // Quantcast / TCF
  ".qc-cmp2-summary-buttons button[mode='primary']",
  "button.css-1k7zk5o",
  // Funding Choices (Google)
  ".fc-cta-consent",
  // Booking.com private modals (sign-in dismiss is not consent but unblocks UI)
  "[aria-label='Dismiss sign-in info.' i]",
  "[aria-label='Dismiss sign in information.' i]",
  // Generic fallbacks (last — risk of false positive lowest among these)
  "button#accept-cookies",
  "button.accept-cookies",
  "button.cookie-accept",
];

export const AUTO_CONSENT_INIT_SCRIPT = `
(() => {
  if (window.__autoConsentInstalled) return;
  window.__autoConsentInstalled = true;
  const SELECTORS = ${JSON.stringify(AUTO_CONSENT_SELECTORS)};
  const clicked = new Set();
  const tryClick = () => {
    for (const sel of SELECTORS) {
      if (clicked.has(sel)) continue;
      let el = null;
      try { el = document.querySelector(sel); } catch { continue; }
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      try {
        el.click();
        clicked.add(sel);
      } catch {}
    }
  };
  // Run on initial load, after DOM ready, and on every mutation burst for
  // ~10s to catch banners injected by lazy CMP scripts.
  const stop = Date.now() + 10_000;
  const tick = () => {
    tryClick();
    if (Date.now() < stop) {
      requestAnimationFrame(() => setTimeout(tick, 250));
    }
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tick, { once: true });
  } else {
    tick();
  }
})();
`;
