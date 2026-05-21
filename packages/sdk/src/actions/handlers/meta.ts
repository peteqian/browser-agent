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

export function handleDone(_ctx: HandlerContext, action: ByName<"done">): ActionResult {
  return ok(`Done (success=${action.params.success}): ${action.params.summary}`, {
    longTermMemory: action.params.summary,
  });
}
