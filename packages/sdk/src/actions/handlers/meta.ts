import type { Action } from "../types";
import { fail, ok, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

export async function handleEval(
  ctx: HandlerContext,
  action: ByName<"eval">,
): Promise<ActionResult> {
  try {
    const value = await ctx.page.evaluate<unknown>(action.params.expression);
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = String(value);
    }
    return ok(`eval result: ${serialized?.slice(0, 4000) ?? "undefined"}`, {
      longTermMemory: "Evaluated JS expression",
      data: { value: serialized },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`eval failed: ${message}`);
  }
}

export async function handleFingerprintReport(ctx: HandlerContext): Promise<ActionResult> {
  const report = await ctx.page.evaluate<unknown>(`(async () => {
    const gl = document.createElement("canvas").getContext("webgl");
    const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
    const notificationPermission = await navigator.permissions
      ?.query?.({ name: "notifications" })
      .then((result) => result.state)
      .catch(() => undefined);

    return {
      url: location.href,
      userAgent: navigator.userAgent,
      webdriver: navigator.webdriver,
      language: navigator.language,
      languages: navigator.languages,
      platform: navigator.platform,
      hardwareConcurrency: navigator.hardwareConcurrency,
      deviceMemory: navigator.deviceMemory,
      maxTouchPoints: navigator.maxTouchPoints,
      pluginsLength: navigator.plugins?.length,
      pluginNames: Array.from(navigator.plugins ?? []).map((plugin) => plugin.name),
      cookieEnabled: navigator.cookieEnabled,
      doNotTrack: navigator.doNotTrack,
      notificationPermission,
      userAgentData: navigator.userAgentData?.toJSON?.() ?? null,
      screen: {
        width: screen.width,
        height: screen.height,
        availWidth: screen.availWidth,
        availHeight: screen.availHeight,
        colorDepth: screen.colorDepth,
        pixelDepth: screen.pixelDepth,
      },
      viewport: {
        innerWidth,
        innerHeight,
        outerWidth,
        outerHeight,
        devicePixelRatio,
      },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      webgl: {
        vendor: gl && debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : null,
        renderer: gl && debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : null,
      },
      chromeRuntime: Boolean(window.chrome?.runtime),
    };
  })()`);
  const serialized = JSON.stringify(report, null, 2);
  return ok(`fingerprint report: ${serialized.slice(0, 6000)}`, {
    longTermMemory: "Collected browser fingerprint report",
    data: report,
  });
}

export function handleDone(_ctx: HandlerContext, action: ByName<"done">): ActionResult {
  return ok(`Done (success=${action.params.success}): ${action.params.summary}`, {
    longTermMemory: action.params.summary,
  });
}
