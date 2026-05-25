import type { Action } from "../types";
import { ok, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

export async function handleScreenshot(
  ctx: HandlerContext,
  action: ByName<"screenshot">,
): Promise<ActionResult> {
  const annotate = action.params.annotate === true;
  const snapshot =
    annotate && ctx.snapshotElements
      ? {
          url: ctx.currentUrl ?? "",
          title: "",
          elements: [...ctx.snapshotElements],
          stability: { readyState: "complete", pendingRequestCount: 0 },
        }
      : undefined;
  const opts = annotate && snapshot ? { annotate: true, snapshot } : undefined;
  if (action.params.fileName) {
    const savedPath = await ctx.page.screenshotToFile(action.params.fileName, opts);
    return ok(`Screenshot saved to ${savedPath}`, { data: { path: savedPath } });
  }
  const base64 = await ctx.page.screenshot(opts);
  return ok("Captured screenshot (base64 PNG)", {
    longTermMemory: "Captured screenshot",
    data: { base64 },
  });
}

export async function handleSaveAsPdf(
  ctx: HandlerContext,
  action: ByName<"save_as_pdf">,
): Promise<ActionResult> {
  const path = await ctx.page.saveAsPdf({
    fileName: action.params.fileName,
    printBackground: action.params.printBackground,
    landscape: action.params.landscape,
    scale: action.params.scale,
    paperFormat: action.params.paperFormat,
  });
  return ok(`Saved page as PDF to ${path}`, { data: { path } });
}
