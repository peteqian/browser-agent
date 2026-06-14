import type { BrowserSession, Page } from "../../browser/session";
import type { SelectorMap } from "../../dom/cdp-snapshot";
import type { Action } from "../types";
import type { ExtractionLLMFn } from "../../agent/decide/contracts";
import type { FocusState } from "../../agent/features/focus-state";
import type { ElementInfo } from "../../dom/types";

export interface ActionResult {
  ok: boolean;
  message: string;
  extractedContent?: string;
  longTermMemory?: string;
  data?: unknown;
  activeTargetId?: string;
}

export interface HandlerContext {
  page: Page;
  session?: BrowserSession;
  signal?: AbortSignal;
  selectorMap?: SelectorMap;
  sensitiveData?: Record<string, string>;
  newTabDetectMs?: number;
  extractionLLM?: ExtractionLLMFn;
  focusState?: FocusState;
  /** Snapshot elements from the observation currently driving this step. */
  snapshotElements?: readonly ElementInfo[];
  currentStep?: number;
  currentUrl?: string;
  /**
   * If set, navigation/new-tab actions reject URLs whose host does not
   * match one of these patterns. See `matchesAllowedDomains` for syntax.
   */
  allowedDomains?: readonly string[];
}

export function ok(message: string, extra?: Omit<ActionResult, "ok" | "message">): ActionResult {
  return { ok: true, message, extractedContent: message, ...extra };
}

export function fail(message: string, extra?: Omit<ActionResult, "ok" | "message">): ActionResult {
  return { ok: false, message, extractedContent: message, ...extra };
}

export function requireSession(
  session: BrowserSession | undefined,
  actionName: Action["name"],
): BrowserSession {
  if (!session) {
    throw new Error(`Action ${actionName} requires BrowserSession`);
  }
  return session;
}

export function resolveBackendId(
  selectorMap: SelectorMap | undefined,
  index: number,
): { ok: true; backendNodeId: number; targetId?: string } | { ok: false; message: string } {
  if (!selectorMap) {
    return { ok: false, message: `Index [${index}] is not present in the current snapshot` };
  }
  const entry = selectorMap.byIndex.get(index);
  if (!entry) {
    return { ok: false, message: `Index [${index}] is not present in the current snapshot` };
  }
  return {
    ok: true,
    backendNodeId: entry.backendNodeId,
    ...(entry.targetId ? { targetId: entry.targetId } : {}),
  };
}

/**
 * Page to execute an element action on. Elements merged from an
 * out-of-process iframe carry a `targetId` — their backendNodeIds only
 * resolve on that target's session.
 */
export function resolveActionPage(ctx: HandlerContext, targetId?: string): Page {
  if (!targetId || targetId === ctx.page.targetId || !ctx.session) return ctx.page;
  return ctx.session.getPage(targetId);
}

export function staleMessage(index: number): string {
  return `Element [${index}] no longer exists in the DOM`;
}

export interface Locator {
  role?: string;
  name?: string;
  text?: string;
  testid?: string;
  label?: string;
  placeholder?: string;
  href?: string;
  stableId?: string;
  dataAttr?: { key: string; value: string };
  nth?: number;
}

export type LocatorResolution =
  | { ok: true; element: ElementInfo; matchedBy: string }
  | { ok: false; reason: "no_match"; message: string }
  | { ok: false; reason: "ambiguous"; message: string };

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function bestEditDistance(needle: string, candidates: readonly string[]): readonly string[] {
  const n = needle.toLowerCase();
  return candidates
    .map((c) => ({ c, d: c.toLowerCase().indexOf(n) }))
    .filter((r) => r.d >= 0)
    .toSorted((a, b) => a.d - b.d)
    .slice(0, 3)
    .map((r) => r.c);
}

/**
 * Resolves a semantic locator to a single ElementInfo. The ladder mirrors
 * the Codex skill's getByTestId → getByRole → getByLabel → getByText
 * priority; we stop at the first ladder rung that returns ≥1 match. If
 * the rung returns >1 and no `nth` was supplied, the call refuses with
 * `ambiguous` rather than guessing.
 */
export function resolveByLocator(
  locator: Locator,
  elements: readonly ElementInfo[],
): LocatorResolution {
  const visible = elements.filter((el) => el.bbox.w > 0 && el.bbox.h > 0);

  type Rung = { name: string; match: (el: ElementInfo) => boolean };
  const ladder: Rung[] = [];

  if (locator.stableId) {
    const needle = locator.stableId;
    ladder.push({
      name: `stableId=${needle}`,
      match: (el) => el.stableId === needle,
    });
  }
  if (locator.testid) {
    const needle = locator.testid;
    ladder.push({
      name: `testid="${needle}"`,
      match: (el) => el.testId === needle,
    });
  }
  if (locator.dataAttr) {
    const { key, value } = locator.dataAttr;
    ladder.push({
      name: `data-${key}="${value}"`,
      match: (el) => el.dataAttrs[key] === value,
    });
  }
  if (locator.role) {
    const roleNeedle = norm(locator.role);
    const nameNeedle = locator.name ? norm(locator.name) : null;
    ladder.push({
      name: nameNeedle ? `role=${locator.role} name="${locator.name}"` : `role=${locator.role}`,
      match: (el) => {
        const role = norm(el.axRole ?? el.role);
        if (role !== roleNeedle) return false;
        if (!nameNeedle) return true;
        const name = norm(el.axName ?? el.ariaName ?? el.text);
        return name === nameNeedle || name.includes(nameNeedle);
      },
    });
  }
  if (locator.label) {
    const needle = norm(locator.label);
    ladder.push({
      name: `label="${locator.label}"`,
      match: (el) => norm(el.labelText) === needle || norm(el.labelText).includes(needle),
    });
  }
  if (locator.placeholder) {
    const needle = norm(locator.placeholder);
    ladder.push({
      name: `placeholder="${locator.placeholder}"`,
      match: (el) => norm(el.placeholder).includes(needle),
    });
  }
  if (locator.href) {
    const needle = locator.href;
    ladder.push({
      name: `href="${needle}"`,
      match: (el) => el.href === needle,
    });
  }
  if (locator.text) {
    const needle = norm(locator.text);
    ladder.push({
      name: `text="${locator.text}"`,
      match: (el) => norm(el.text).includes(needle) || norm(el.axName).includes(needle),
    });
  }

  if (ladder.length === 0) {
    return { ok: false, reason: "no_match", message: "locator is empty" };
  }

  for (const rung of ladder) {
    const matches = visible.filter(rung.match);
    if (matches.length === 0) continue;
    if (matches.length === 1) {
      return { ok: true, element: matches[0]!, matchedBy: rung.name };
    }
    if (typeof locator.nth === "number") {
      const picked = matches[locator.nth];
      if (!picked) {
        return {
          ok: false,
          reason: "no_match",
          message: `${rung.name} matched ${matches.length} elements but nth=${locator.nth} is out of range.`,
        };
      }
      return { ok: true, element: picked, matchedBy: `${rung.name}[nth=${locator.nth}]` };
    }
    const candidates = matches
      .slice(0, 5)
      .map((el) => `[${el.index}] ${el.stableHandle.value || el.tag}`)
      .join("; ");
    return {
      ok: false,
      reason: "ambiguous",
      message: `${rung.name} matched ${matches.length} elements. Add 'nth' or tighten scope. Candidates: ${candidates}`,
    };
  }

  // No rung produced matches. Build a hint by surfacing the closest
  // accessible names so the agent can correct its query.
  const accessibleNames = visible
    .map((el) => el.axName ?? el.ariaName ?? el.text ?? "")
    .filter((s) => s.length > 0);
  const needle =
    locator.testid ?? locator.name ?? locator.label ?? locator.text ?? locator.placeholder ?? "";
  const suggestions = needle ? bestEditDistance(needle, accessibleNames) : [];
  const hint = suggestions.length > 0 ? ` Did you mean one of: ${suggestions.join(" | ")}?` : "";
  return {
    ok: false,
    reason: "no_match",
    message: `Locator did not match any visible element.${hint}`,
  };
}

const SECRET_RE = /<secret>([a-zA-Z0-9_.-]+)<\/secret>/g;

export function substituteSecrets(
  text: string,
  secrets: Record<string, string> | undefined,
): { ok: true; value: string } | { ok: false; key: string } {
  let missing: string | null = null;
  const replaced = text.replace(SECRET_RE, (match, key: string) => {
    if (secrets && Object.prototype.hasOwnProperty.call(secrets, key)) {
      return secrets[key] as string;
    }
    if (!missing) missing = key;
    return match;
  });
  return missing ? { ok: false, key: missing } : { ok: true, value: replaced };
}
