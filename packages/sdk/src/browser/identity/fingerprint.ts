import type Protocol from "devtools-protocol";

/**
 * Declarative browser-fingerprint surface. Agents pick a preset (or supply a
 * partial profile merged over one) and the session translates it into the
 * stealth init script plus the CDP `Emulation.setUserAgentOverride` payload,
 * keeping every JS-visible signal coherent with the network-visible ones.
 */
export interface FingerprintProfile {
  /** Preset to merge partial values over. Default: "macos-chrome". */
  preset?: FingerprintPreset;
  userAgent?: string;
  acceptLanguage?: string;
  /** navigator.languages; first entry doubles as navigator.language. */
  languages?: string[];
  /** navigator.platform, e.g. "MacIntel" / "Win32" / "Linux x86_64". */
  platform?: string;
  /** userAgentMetadata.platform, e.g. "macOS" / "Windows" / "Linux". */
  uaPlatform?: string;
  uaPlatformVersion?: string;
  architecture?: string;
  bitness?: string;
  mobile?: boolean;
  brands?: Array<{ brand: string; version: string }>;
  fullVersionList?: Array<{ brand: string; version: string }>;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  maxTouchPoints?: number;
  webglVendor?: string;
  webglRenderer?: string;
  /** Override screen dimensions reported to JS. Omit to keep real values. */
  screen?: { width: number; height: number; colorDepth?: number };
}

export type FingerprintPreset = "macos-chrome" | "windows-chrome" | "linux-chrome";

export type FingerprintInit = FingerprintPreset | FingerprintProfile;

export type ResolvedFingerprint = Required<
  Omit<FingerprintProfile, "preset" | "screen" | "deviceMemory">
> & {
  deviceMemory: number;
  screen?: { width: number; height: number; colorDepth?: number };
};

const CHROME_MAJOR = "131";
const CHROME_FULL = "131.0.6778.86";

function chromeBrands(): Array<{ brand: string; version: string }> {
  return [
    { brand: "Google Chrome", version: CHROME_MAJOR },
    { brand: "Chromium", version: CHROME_MAJOR },
    { brand: "Not_A Brand", version: "24" },
  ];
}

function chromeFullVersionList(): Array<{ brand: string; version: string }> {
  return [
    { brand: "Google Chrome", version: CHROME_FULL },
    { brand: "Chromium", version: CHROME_FULL },
    { brand: "Not_A Brand", version: "24.0.0.0" },
  ];
}

const FINGERPRINT_PRESETS: Record<FingerprintPreset, ResolvedFingerprint> = {
  "macos-chrome": {
    userAgent: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`,
    acceptLanguage: "en-US,en;q=0.9",
    languages: ["en-US", "en"],
    platform: "MacIntel",
    uaPlatform: "macOS",
    uaPlatformVersion: "14.5.0",
    architecture: "arm",
    bitness: "64",
    mobile: false,
    brands: chromeBrands(),
    fullVersionList: chromeFullVersionList(),
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webglVendor: "Intel Inc.",
    webglRenderer: "Intel Iris OpenGL Engine",
  },
  "windows-chrome": {
    userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`,
    acceptLanguage: "en-US,en;q=0.9",
    languages: ["en-US", "en"],
    platform: "Win32",
    uaPlatform: "Windows",
    uaPlatformVersion: "15.0.0",
    architecture: "x86",
    bitness: "64",
    mobile: false,
    brands: chromeBrands(),
    fullVersionList: chromeFullVersionList(),
    hardwareConcurrency: 12,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webglVendor: "Google Inc. (NVIDIA)",
    webglRenderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)",
  },
  "linux-chrome": {
    userAgent: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROME_MAJOR}.0.0.0 Safari/537.36`,
    acceptLanguage: "en-US,en;q=0.9",
    languages: ["en-US", "en"],
    platform: "Linux x86_64",
    uaPlatform: "Linux",
    uaPlatformVersion: "6.8.0",
    architecture: "x86",
    bitness: "64",
    mobile: false,
    brands: chromeBrands(),
    fullVersionList: chromeFullVersionList(),
    hardwareConcurrency: 8,
    deviceMemory: 8,
    maxTouchPoints: 0,
    webglVendor: "Google Inc. (Intel)",
    webglRenderer: "ANGLE (Intel, Mesa Intel(R) UHD Graphics 630, OpenGL 4.6)",
  },
};

/**
 * Merge a partial profile over its preset (default "macos-chrome").
 * `overrides` lets session-level fields (profile.userAgent, locale, …) win
 * over both without callers duplicating merge logic.
 */
export function resolveFingerprint(
  init?: FingerprintInit,
  overrides?: Pick<FingerprintProfile, "userAgent" | "acceptLanguage">,
): ResolvedFingerprint {
  const partial: FingerprintProfile = typeof init === "string" ? { preset: init } : (init ?? {});
  const base = FINGERPRINT_PRESETS[partial.preset ?? "macos-chrome"];
  const resolved: ResolvedFingerprint = {
    ...base,
    languages: [...base.languages],
    brands: base.brands.map((b) => ({ ...b })),
    fullVersionList: base.fullVersionList.map((b) => ({ ...b })),
  };
  const apply = (source?: FingerprintProfile) => {
    if (!source) return;
    for (const [key, value] of Object.entries(source)) {
      if (key === "preset" || value === undefined) continue;
      (resolved as Record<string, unknown>)[key] = value;
    }
  };
  apply(partial);
  apply(overrides);
  return resolved;
}

/**
 * Builds the `Emulation.setUserAgentOverride` payload so the HTTP-visible
 * UA + client hints match the JS-visible fingerprint.
 */
export function buildUserAgentOverride(
  fp: ResolvedFingerprint,
): Protocol.Emulation.SetUserAgentOverrideRequest {
  return {
    userAgent: fp.userAgent,
    acceptLanguage: fp.acceptLanguage,
    platform: fp.platform,
    userAgentMetadata: {
      brands: fp.brands,
      fullVersionList: fp.fullVersionList,
      platform: fp.uaPlatform,
      platformVersion: fp.uaPlatformVersion,
      architecture: fp.architecture,
      model: "",
      mobile: fp.mobile,
      bitness: fp.bitness,
      wow64: false,
    },
  };
}

// Patches the most common headless-detection vectors, parameterized by the
// resolved fingerprint. Keep in sync with the puppeteer-extra-stealth
// playbook: navigator.webdriver, plugins, Notification.permission, WebGL
// renderer/vendor, chrome.runtime, and a permissions.query bypass that
// returns Notification.permission for notifications (real Chrome returns
// "default" before any user prompt).
export function buildFingerprintInitScript(fp: ResolvedFingerprint): string {
  const screenPatch = fp.screen
    ? `
  patch(Screen.prototype, "width", ${JSON.stringify(fp.screen.width)});
  patch(Screen.prototype, "height", ${JSON.stringify(fp.screen.height)});
  patch(Screen.prototype, "availWidth", ${JSON.stringify(fp.screen.width)});
  patch(Screen.prototype, "availHeight", ${JSON.stringify(fp.screen.height)});
  patch(Screen.prototype, "colorDepth", ${JSON.stringify(fp.screen.colorDepth ?? 24)});
  patch(Screen.prototype, "pixelDepth", ${JSON.stringify(fp.screen.colorDepth ?? 24)});`
    : "";

  return `
(() => {
  if (window.__stealthInstalled) return;
  window.__stealthInstalled = true;
  const patch = (obj, key, value) => {
    try {
      Object.defineProperty(obj, key, { get: () => value, configurable: true });
    } catch {}
  };

  patch(Navigator.prototype, "webdriver", undefined);
  patch(Navigator.prototype, "language", ${JSON.stringify(fp.languages[0] ?? "en-US")});
  patch(Navigator.prototype, "languages", ${JSON.stringify(fp.languages)});
  patch(Navigator.prototype, "hardwareConcurrency", ${JSON.stringify(fp.hardwareConcurrency)});
  patch(Navigator.prototype, "deviceMemory", ${JSON.stringify(fp.deviceMemory)});
  patch(Navigator.prototype, "maxTouchPoints", ${JSON.stringify(fp.maxTouchPoints)});
  patch(Navigator.prototype, "platform", ${JSON.stringify(fp.platform)});
${screenPatch}

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
    const vendor = ${JSON.stringify(fp.webglVendor)};
    const renderer = ${JSON.stringify(fp.webglRenderer)};
    const proto = WebGLRenderingContext.prototype;
    const getParam = proto.getParameter;
    proto.getParameter = function (param) {
      if (param === 37445) return vendor; // UNMASKED_VENDOR_WEBGL
      if (param === 37446) return renderer; // UNMASKED_RENDERER_WEBGL
      return getParam.call(this, param);
    };
    const proto2 = (window).WebGL2RenderingContext?.prototype;
    if (proto2) {
      const getParam2 = proto2.getParameter;
      proto2.getParameter = function (param) {
        if (param === 37445) return vendor;
        if (param === 37446) return renderer;
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
}
