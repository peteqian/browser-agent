import type { Action } from "../types";
import { fail, ok, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

export async function handleWait(
  ctx: HandlerContext,
  action: ByName<"wait">,
): Promise<ActionResult> {
  await ctx.page.waitForTimeout(action.params.ms);
  return ok(`Waited ${action.params.ms}ms`);
}

export async function handleWaitForText(
  ctx: HandlerContext,
  action: ByName<"wait_for_text">,
): Promise<ActionResult> {
  const found = await ctx.page.waitForText(action.params.text, action.params.timeoutMs ?? 10_000);
  return found
    ? ok(`Text found: ${action.params.text}`, { longTermMemory: "Found text on page" })
    : fail(`Timed out waiting for text: ${action.params.text}`);
}

export async function handleWaitForUrl(
  ctx: HandlerContext,
  action: ByName<"wait_for_url">,
): Promise<ActionResult> {
  const timeoutMs = action.params.timeoutMs ?? 10_000;
  const url = await ctx.page.waitForUrl(action.params.pattern, timeoutMs);
  if (url === null) {
    return fail(`Timed out after ${timeoutMs}ms waiting for URL pattern: ${action.params.pattern}`);
  }
  return ok(`URL matched pattern '${action.params.pattern}': ${url}`, {
    longTermMemory: `URL matched pattern '${action.params.pattern}'`,
    data: { url },
  });
}

export async function handleWaitForCondition(
  ctx: HandlerContext,
  action: ByName<"wait_for_condition">,
): Promise<ActionResult> {
  const timeoutMs = action.params.timeoutMs ?? 10_000;
  const value = await ctx.page.waitForCondition(action.params.expression, timeoutMs);
  if (value === null) {
    return fail(`Timed out after ${timeoutMs}ms waiting for: ${action.params.expression}`);
  }
  return ok(`Condition became truthy: ${action.params.expression}`, {
    longTermMemory: "Wait-for-condition succeeded",
    data: { value },
  });
}
