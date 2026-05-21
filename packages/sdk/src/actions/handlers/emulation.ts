import type { Action } from "../types";
import { fail, ok, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

export async function handleSetViewport(
  ctx: HandlerContext,
  action: ByName<"set_viewport">,
): Promise<ActionResult> {
  const { width, height, deviceScaleFactor, mobile } = action.params;
  try {
    await ctx.page.sendCDP("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: deviceScaleFactor ?? 1,
      mobile: mobile ?? false,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`Failed to set viewport: ${message}`);
  }
  return ok(
    `Set viewport to ${width}x${height}${mobile ? " (mobile)" : ""}${deviceScaleFactor ? ` @${deviceScaleFactor}x` : ""}`,
    {
      longTermMemory: `Viewport set to ${width}x${height}`,
      data: { width, height, deviceScaleFactor: deviceScaleFactor ?? 1, mobile: mobile ?? false },
    },
  );
}
