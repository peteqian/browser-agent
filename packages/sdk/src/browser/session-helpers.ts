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
