import type { Page } from "../browser/session";

/**
 * Cheap post-action verification. After an action the runner can assert the
 * page reached an expected state — URL changed, an element disappeared, text
 * appeared/vanished — without spending a full LLM re-observe. A failed
 * assertion downgrades the action result to a failure with a clear message,
 * so silent no-ops (a click that didn't navigate, a submit that didn't clear
 * the form) surface immediately.
 */
export type PostCondition =
  | { type: "url_changed" }
  | { type: "url_contains"; value: string }
  | { type: "element_gone"; selector: string }
  | { type: "element_present"; selector: string }
  | { type: "text_present"; value: string }
  | { type: "text_absent"; value: string };

export interface PostConditionResult {
  ok: boolean;
  message: string;
}

const COUNT_SELECTOR = (selector: string) =>
  `(() => { try { return document.querySelectorAll(${JSON.stringify(selector)}).length; } catch { return -1; } })()`;

const BODY_TEXT = `(() => (document.body && document.body.innerText) || "")()`;

/**
 * Evaluate `condition` against the live page. `beforeUrl` is the URL captured
 * before the action ran (needed for `url_changed`).
 */
export async function checkPostCondition(
  page: Page,
  condition: PostCondition,
  beforeUrl?: string,
): Promise<PostConditionResult> {
  switch (condition.type) {
    case "url_changed": {
      const now = await page.currentUrl().catch(() => undefined);
      const ok = now !== undefined && now !== beforeUrl;
      return { ok, message: ok ? "url changed" : `url did not change (still ${now ?? "unknown"})` };
    }
    case "url_contains": {
      const now = (await page.currentUrl().catch(() => "")) ?? "";
      const ok = now.includes(condition.value);
      return {
        ok,
        message: ok ? "url matched" : `url "${now}" does not contain "${condition.value}"`,
      };
    }
    case "element_gone": {
      const count = await page.evaluate<number>(COUNT_SELECTOR(condition.selector)).catch(() => -1);
      const ok = count === 0;
      return {
        ok,
        message: ok ? "element gone" : `element "${condition.selector}" still present (${count})`,
      };
    }
    case "element_present": {
      const count = await page.evaluate<number>(COUNT_SELECTOR(condition.selector)).catch(() => -1);
      const ok = count > 0;
      return { ok, message: ok ? "element present" : `element "${condition.selector}" not found` };
    }
    case "text_present": {
      const body = (await page.evaluate<string>(BODY_TEXT).catch(() => "")) ?? "";
      const ok = body.includes(condition.value);
      return { ok, message: ok ? "text present" : `text "${condition.value}" not found on page` };
    }
    case "text_absent": {
      const body = (await page.evaluate<string>(BODY_TEXT).catch(() => "")) ?? "";
      const ok = !body.includes(condition.value);
      return { ok, message: ok ? "text absent" : `text "${condition.value}" still present` };
    }
    default:
      return { ok: true, message: "no condition" };
  }
}
