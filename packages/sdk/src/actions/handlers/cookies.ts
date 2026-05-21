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
    const result = (await ctx.page.sendCDP("Storage.getCookies", {})) as {
      cookies?: CDPCookie[];
    };
    let cookies = result.cookies ?? [];
    if (action.params.urls && action.params.urls.length > 0) {
      const hosts = new Set(
        action.params.urls.map((u) => {
          try {
            return new URL(u).hostname.toLowerCase();
          } catch {
            return "";
          }
        }),
      );
      cookies = cookies.filter((c) => {
        const host = c.domain.replace(/^\./, "").toLowerCase();
        for (const h of hosts) {
          if (!h) continue;
          if (host === h || h.endsWith(`.${host}`) || host.endsWith(`.${h}`)) return true;
        }
        return false;
      });
    }
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
    await ctx.page.sendCDP("Storage.setCookies", { cookies: action.params.cookies });
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
    await ctx.page.sendCDP("Storage.clearCookies", {});
    return ok("Cleared all cookies", { longTermMemory: "Cleared all cookies" });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`Failed to clear cookies: ${message}`);
  }
}
