import type { Page } from "../../browser/page/page";
import type { Action } from "../types";
import { fail, ok, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

interface DialogState {
  unsubscribe: () => void;
  pending: Array<{ type: string; message: string; defaultPrompt?: string }>;
}

const dialogStateByTarget = new WeakMap<Page, DialogState>();
// In-flight installation guard so two concurrent callers share the same
// subscription instead of double-subscribing.
const dialogInstallByTarget = new WeakMap<Page, Promise<DialogState>>();

async function ensureDialogListener(page: Page): Promise<DialogState> {
  const existing = dialogStateByTarget.get(page);
  if (existing) return existing;
  const pending = dialogInstallByTarget.get(page);
  if (pending) return pending;
  const install = (async () => {
    const state: DialogState = {
      unsubscribe: () => {},
      pending: [],
    };
    state.unsubscribe = await page.session.onTargetEvent<{
      type: string;
      message: string;
      defaultPrompt?: string;
    }>(page.targetId, "Page.javascriptDialogOpening", (params) => {
      state.pending.push({
        type: params.type,
        message: params.message,
        defaultPrompt: params.defaultPrompt,
      });
    });
    dialogStateByTarget.set(page, state);
    return state;
  })();
  dialogInstallByTarget.set(page, install);
  try {
    return await install;
  } finally {
    dialogInstallByTarget.delete(page);
  }
}

/** Internal entry used by session bootstrap; we expose via this handler instead. */
export async function primeDialogListener(page: Page): Promise<void> {
  await ensureDialogListener(page);
}

export async function handleDialogHandle(
  ctx: HandlerContext,
  action: ByName<"dialog_handle">,
): Promise<ActionResult> {
  // Make sure we're listening even if the dialog hasn't opened yet — the
  // call could be racing. We respond to whatever dialog is currently open.
  await ensureDialogListener(ctx.page);
  try {
    await ctx.page.sendCDP("Page.handleJavaScriptDialog", {
      accept: action.params.accept,
      promptText: action.params.promptText,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`dialog_handle failed: ${message}`);
  }
  const state = dialogStateByTarget.get(ctx.page);
  const handled = state?.pending.shift();
  const verb = action.params.accept ? "Accepted" : "Dismissed";
  return ok(
    handled
      ? `${verb} ${handled.type} dialog: ${handled.message.slice(0, 200)}`
      : `${verb} JS dialog (no queued dialog metadata)`,
    { longTermMemory: `${verb} JS dialog` },
  );
}
