import { basename, relative, resolve } from "node:path";
import type {
  JavascriptDialogOpeningEvent,
  NavigationHealthStatus,
  RuntimeExceptionDetails,
} from "./session-types";

export function formatRuntimeException(details: RuntimeExceptionDetails): string {
  const line = typeof details.lineNumber === "number" ? ` at ${details.lineNumber + 1}` : "";
  const column = typeof details.columnNumber === "number" ? `:${details.columnNumber + 1}` : "";
  const description =
    details.exception?.description ??
    (typeof details.exception?.value === "string" ? details.exception.value : undefined);
  return `${details.text ?? "unknown error"}${line}${column}${description ? ` — ${description}` : ""}`;
}

export function navigationFailureStatus(message: string): NavigationHealthStatus {
  return message.includes("Navigation timeout") ? "timeout" : "cdp_error";
}

export function createJavaScriptDialogWatchdogData(event: JavascriptDialogOpeningEvent): {
  dialogType: "alert" | "confirm" | "prompt" | "beforeunload";
  accepted: boolean;
  policy: "accept_non_prompt" | "dismiss_prompt";
  event: JavascriptDialogOpeningEvent;
} {
  const dialogType = event.type ?? "alert";
  const accepted = dialogType !== "prompt";
  return {
    dialogType,
    accepted,
    policy: accepted ? "accept_non_prompt" : "dismiss_prompt",
    event,
  };
}

/**
 * Resolves a safe download path inside `downloadsDir`.
 * `basename` strips any directory components from `suggestedFilename`, so
 * subdirectories are flattened to the root of `downloadsDir`.
 */
export function safeDownloadPath(downloadsDir: string, suggestedFilename: string): string {
  const targetPath = resolve(downloadsDir, basename(suggestedFilename));
  const relativePath = relative(resolve(downloadsDir), targetPath);
  if (relativePath.startsWith("..") || relativePath === "") {
    return resolve(downloadsDir, "download");
  }
  return targetPath;
}

export const AD_DOMAINS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googletagmanager.com",
  "facebook.net",
  "analytics",
  "ads",
  "tracking",
  "pixel",
  "hotjar.com",
  "clarity.ms",
  "mixpanel.com",
  "segment.com",
  "demdex.net",
  "omtrdc.net",
  "adobedtm.com",
  "ensighten.com",
  "newrelic.com",
  "nr-data.net",
  "google-analytics.com",
  "connect.facebook.net",
  "platform.twitter.com",
  "platform.linkedin.com",
  ".cloudfront.net/image/",
  ".akamaized.net/image/",
  "/tracker/",
  "/collector/",
  "/beacon/",
  "/telemetry/",
  "/log/",
  "/events/",
  "/eventBatch",
  "/track.",
  "/metrics/",
];

// Patches the most common headless-detection vectors. Keep in sync with the
// puppeteer-extra-stealth playbook: navigator.webdriver, plugins,
// Notification.permission, WebGL renderer/vendor, chrome.runtime, and a
// permissions.query bypass that returns "denied" for notifications (real
// Chrome returns "default" before any user prompt).
export const STEALTH_INIT_SCRIPT = `
(() => {
  if (window.__stealthInstalled) return;
  window.__stealthInstalled = true;
  const patch = (obj, key, value) => {
    try {
      Object.defineProperty(obj, key, { get: () => value, configurable: true });
    } catch {}
  };

  patch(Navigator.prototype, "webdriver", undefined);
  patch(Navigator.prototype, "language", "en-US");
  patch(Navigator.prototype, "languages", ["en-US", "en"]);
  patch(Navigator.prototype, "hardwareConcurrency", 8);
  patch(Navigator.prototype, "deviceMemory", 8);
  patch(Navigator.prototype, "maxTouchPoints", 0);

  // navigator.plugins: real PluginArray with at least a PDF viewer entry.
  try {
    const fakePlugin = (name, filename, description) => ({
      name, filename, description, length: 1,
      0: { type: "application/pdf", suffixes: "pdf", description },
      item: () => null, namedItem: () => null,
    });
    const arr = [
      fakePlugin("PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      fakePlugin("Chrome PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      fakePlugin("Chromium PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      fakePlugin("Microsoft Edge PDF Viewer", "internal-pdf-viewer", "Portable Document Format"),
      fakePlugin("WebKit built-in PDF", "internal-pdf-viewer", "Portable Document Format"),
    ];
    arr.item = (i) => arr[i] || null;
    arr.namedItem = (n) => arr.find(p => p.name === n) || null;
    arr.refresh = () => {};
    Object.setPrototypeOf(arr, PluginArray.prototype);
    patch(Navigator.prototype, "plugins", arr);
  } catch {}

  // permissions.query → Notification "denied" → "default" so headless flag
  // doesn't leak via async permission state.
  try {
    const originalQuery = window.navigator.permissions?.query?.bind(window.navigator.permissions);
    if (originalQuery) {
      window.navigator.permissions.query = (params) => {
        if (params?.name === "notifications") {
          return Promise.resolve({ state: Notification.permission || "default" });
        }
        return originalQuery(params);
      };
    }
  } catch {}

  // WebGL vendor/renderer spoof — bot detectors compare these against UA.
  try {
    const proto = WebGLRenderingContext.prototype;
    const getParam = proto.getParameter;
    proto.getParameter = function (param) {
      if (param === 37445) return "Intel Inc."; // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return "Intel Iris OpenGL Engine"; // UNMASKED_RENDERER_WEBGL
      return getParam.call(this, param);
    };
    const proto2 = (window).WebGL2RenderingContext?.prototype;
    if (proto2) {
      const getParam2 = proto2.getParameter;
      proto2.getParameter = function (param) {
        if (param === 37445) return "Intel Inc.";
        if (param === 37446) return "Intel Iris OpenGL Engine";
        return getParam2.call(this, param);
      };
    }
  } catch {}

  // chrome.runtime — required by many bot detectors that check for
  // window.chrome.runtime existence.
  if (!window.chrome) window.chrome = {};
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      OnInstalledReason: { INSTALL: "install", UPDATE: "update" },
      OnRestartRequiredReason: { APP_UPDATE: "app_update", OS_UPDATE: "os_update" },
      PlatformArch: { ARM: "arm", X86_32: "x86-32", X86_64: "x86-64" },
      PlatformOs: { MAC: "mac", WIN: "win", LINUX: "linux" },
      RequestUpdateCheckStatus: { THROTTLED: "throttled" },
      connect: () => ({ disconnect: () => {}, postMessage: () => {} }),
      sendMessage: () => {},
    };
  }
  if (!window.chrome.csi) window.chrome.csi = () => ({});
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = () => ({
      commitLoadTime: 0, finishDocumentLoadTime: 0, finishLoadTime: 0,
      firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: "Other",
      npnNegotiatedProtocol: "h2", requestTime: 0, startLoadTime: 0,
      wasAlternateProtocolAvailable: false, wasFetchedViaSpdy: true,
      wasNpnNegotiated: true,
    });
  }
})();
`;
