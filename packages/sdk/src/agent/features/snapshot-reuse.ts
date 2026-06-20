import { actionSchemas } from "../../actions/types";
import type { Page } from "../../browser/session/session";

/**
 * Snapshot reuse: skip the full DOM capture + serialize when the previous
 * step provably did not change the page (lookup-style custom actions, failed
 * actions, empty decisions). Two gates must both pass:
 *
 *   1. `canReuseSnapshot` — a static check over the actions the model just
 *      ran. Any built-in that navigates, clicks, types, scrolls, or otherwise
 *      mutates page/observation state disqualifies the step.
 *   2. A page fingerprint (`capturePageFingerprint`) captured right after the
 *      previous observation must match the current one — this catches custom
 *      actions (and background scripts) that mutated the DOM anyway.
 *
 * Anything ambiguous re-captures; reuse is purely an optimization.
 */

/**
 * Built-in actions with no page side effects and no influence on how the
 * observation is rendered. Deliberately excludes `wait*` (the whole point is
 * picking up new content), `focus_area` (changes observation rendering),
 * `find_text` (scrolls), `eval` (arbitrary JS), and everything that
 * dispatches input or navigates.
 */
const READ_ONLY_ACTIONS = new Set<string>([
  "done",
  "screenshot",
  "save_as_pdf",
  "search_page",
  "find_elements",
  "find_by_role",
  "find_by_text",
  "find_by_testid",
  "get_dropdown_options",
  "fingerprint_report",
  "network_har_start",
  "network_har_stop",
  "network_list_requests",
  "console_start",
  "console_read",
  "console_stop",
  "cookies_get",
  "profiler_start",
  "profiler_stop",
]);

/**
 * Actions that can leave partial page effects even when they report failure
 * (e.g. `type` fails value verification *after* dispatching keystrokes).
 * Failures from these always force a re-capture.
 */
const PARTIAL_EFFECT_ACTIONS = new Set<string>([
  "type",
  "fill",
  "type_by",
  "keyboard_type",
  "send_keys",
  "press",
  "select_option",
  "select_by",
  "upload_file",
  "eval",
]);

const BUILTIN_ACTION_NAMES = new Set<string>(Object.keys(actionSchemas));

/** One executed (or parse-rejected) action from the previous step. */
export interface ExecutedStepAction {
  name: string;
  ok: boolean;
}

/**
 * Static gate: true when every action from the previous step is known not to
 * have changed the page or the way the observation is rendered. Successful
 * custom (non-built-in) actions pass — the fingerprint gate covers ones that
 * touch the DOM after all. An empty step (no actions) trivially passes.
 */
export function canReuseSnapshot(actions: readonly ExecutedStepAction[]): boolean {
  return actions.every((action) => {
    if (READ_ONLY_ACTIONS.has(action.name)) return true;
    // Failed actions produced no observable change — unless the action kind
    // can fail halfway through dispatching input.
    if (!action.ok) return !PARTIAL_EFFECT_ACTIONS.has(action.name);
    // Successful built-ins outside the read-only set may have mutated the
    // page (navigate/click/type/scroll/...). Custom actions are the main
    // reuse win; the fingerprint gate guards the ones with side effects.
    return !BUILTIN_ACTION_NAMES.has(action.name);
  });
}

/** Fingerprinting must never wedge the loop on a hung/destroyed page. */
const FINGERPRINT_TIMEOUT_MS = 1_500;

/**
 * Cheap "page unchanged" probe: URL, title, readyState, scroll offset, node
 * count, and serialized-HTML length. Orders of magnitude cheaper than a full
 * CDP snapshot + accessibility tree + serialization, yet any navigation,
 * scroll, or DOM mutation shifts at least one component.
 */
const PAGE_FINGERPRINT_EXPRESSION = `(() => JSON.stringify({
  url: location.href,
  title: document.title,
  ready: document.readyState,
  scroll: [Math.round(window.scrollX), Math.round(window.scrollY)],
  nodes: document.getElementsByTagName("*").length,
  html: document.documentElement ? document.documentElement.outerHTML.length : 0,
}))()`;

/**
 * Capture the page fingerprint. Returns null on any failure or timeout so
 * callers fall back to a full re-capture (the conservative path).
 */
export async function capturePageFingerprint(page: Page): Promise<string | null> {
  const value = await withTimeout(
    page.evaluate<unknown>(PAGE_FINGERPRINT_EXPRESSION).catch(() => null),
    FINGERPRINT_TIMEOUT_MS,
  );
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  // Defensive: some transports return structured values for JSON expressions.
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T | null>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    void promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}
