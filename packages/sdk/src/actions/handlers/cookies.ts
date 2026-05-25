import type { Action } from "../types";
import { fail, ok, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

interface CDPCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: string;
  expires?: number;
}

export async function handleCookiesGet(
  ctx: HandlerContext,
  action: ByName<"cookies_get">,
): Promise<ActionResult> {
  try {
    const urls =
      action.params.urls && action.params.urls.length > 0 ? action.params.urls : undefined;
    const result = (await ctx.page.sendCDP("Network.getCookies", urls ? { urls } : {})) as {
      cookies?: CDPCookie[];
    };
    const cookies = result.cookies ?? [];
    const max = action.params.maxResults ?? 200;
    const sliced = cookies.slice(0, max);
    return ok(`Got ${sliced.length}/${cookies.length} cookies`, {
      longTermMemory: `Got ${sliced.length} cookies`,
      data: { total: cookies.length, cookies: sliced },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`Failed to read cookies: ${message}`);
  }
}

export async function handleCookiesSet(
  ctx: HandlerContext,
  action: ByName<"cookies_set">,
): Promise<ActionResult> {
  try {
    await ctx.page.sendCDP("Network.setCookies", { cookies: action.params.cookies });
    return ok(
      `Set ${action.params.cookies.length} cookie${action.params.cookies.length === 1 ? "" : "s"}`,
      {
        longTermMemory: `Set ${action.params.cookies.length} cookies`,
        data: { count: action.params.cookies.length },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`Failed to set cookies: ${message}`);
  }
}

export async function handleCookiesClear(
  ctx: HandlerContext,
  _action: ByName<"cookies_clear">,
): Promise<ActionResult> {
  try {
    await ctx.page.sendCDP("Network.clearBrowserCookies", {});
    return ok("Cleared all cookies", { longTermMemory: "Cleared all cookies" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`Failed to clear cookies: ${message}`);
  }
}
