import type { Page } from "../browser/session";
import {
  captureCdpSnapshot,
  withBudgetDefaults,
  type DomBudgetOptions,
  type RequiredDomBudgets,
  type SelectorMap,
} from "./cdp-snapshot";
import { diffSnapshots } from "./snapshot-diff";
import type { ElementInfo, PageSnapshot } from "./types";

export type { DomBudgetOptions, SelectorMap } from "./cdp-snapshot";

export async function serializePage(
  page: Page,
  budgets?: DomBudgetOptions,
): Promise<{ snapshot: PageSnapshot; selectorMap: SelectorMap }> {
  return captureCdpSnapshot(page, withBudgetDefaults(budgets));
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}...`;
}

function escapeName(value: string): string {
  // Keep names readable. JSON-escape only when the name contains quotes or
  // backslashes; otherwise pass through verbatim.
  if (!/["\\]/.test(value)) return value;
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const INPUT_TAGS = new Set(["input", "textarea"]);

function isInputLike(el: ElementInfo): boolean {
  const role = (el.axRole ?? el.role ?? "").toLowerCase();
  if (role === "textbox" || role === "searchbox" || role === "combobox") return true;
  return INPUT_TAGS.has(el.tag.toLowerCase());
}

function pickName(el: ElementInfo): string {
  if (isInputLike(el)) {
    const candidates = [el.value, el.axName, el.ariaName, el.placeholder, el.ariaLabel, el.text];
    for (const c of candidates) {
      if (c && c.trim() !== "") return c.trim();
    }
    return "";
  }
  const candidates = [el.axName, el.ariaName, el.text, el.placeholder, el.value, el.ariaLabel];
  for (const c of candidates) {
    if (c && c.trim() !== "") return c.trim();
  }
  return "";
}

function pickState(el: ElementInfo): string {
  const parts: string[] = [];
  const type = (el.type ?? "").toLowerCase();
  const role = (el.axRole ?? el.role ?? "").toLowerCase();
  const attrs = el.dataAttrs;

  const ariaChecked = attrs["aria-checked"];
  if (type === "checkbox" || type === "radio" || role === "checkbox" || role === "radio") {
    const checked =
      ariaChecked === "true" || attrs["checked"] === "" || attrs["checked"] === "true";
    if (checked) parts.push("checked");
  } else if (ariaChecked === "true") {
    parts.push("checked");
  }

  if (attrs["disabled"] !== undefined || attrs["aria-disabled"] === "true") {
    parts.push("disabled");
  }

  const ariaExpanded = attrs["aria-expanded"];
  if (ariaExpanded === "false") parts.push("expanded=false");
  else if (ariaExpanded === "true") parts.push("expanded=true");

  const ariaSelected = attrs["aria-selected"];
  if (ariaSelected === "true") parts.push("selected");

  if (parts.length === 0) return "";
  return parts.map((p) => `[${p}]`).join("");
}

/**
 * Compact, AX-tree style line per element:
 *   @e<index> [<role>] "<name>"<state>
 * Role prefers ARIA/AX role and falls back to the tag name. Name is the
 * first non-empty accessible label. State suffix is included only when
 * load-bearing. Stable handles and ids stay on the in-memory ElementInfo
 * (used by handlers) but are kept out of the rendered string to save tokens.
 */
function renderElementLine(el: ElementInfo, fieldChars: number): string {
  const role = (el.axRole ?? el.tag).toLowerCase();
  const rawName = pickName(el);
  const name = rawName ? truncate(escapeName(rawName), fieldChars) : "";
  const state = pickState(el);

  let line = `@e${el.index} [${role}] "${name}"${state}`;

  // Keep href visible only for unnamed links (it's the only signal left).
  if (role === "link" && !rawName && el.href) {
    line += ` href="${truncate(el.href, 80)}"`;
  }
  return line;
}

export function formatSnapshotForLLM(
  snapshot: PageSnapshot,
  budgetsOrLimit?: DomBudgetOptions | number,
): string {
  const budgets: RequiredDomBudgets =
    typeof budgetsOrLimit === "number"
      ? withBudgetDefaults({ maxDisplayElements: budgetsOrLimit })
      : withBudgetDefaults(budgetsOrLimit);

  const limit = budgets.maxDisplayElements;
  const fieldChars = budgets.maxFieldChars;
  const totalCap = budgets.maxTotalChars;

  const header: string[] = [];
  header.push(`URL: ${snapshot.url}`);
  header.push(`TITLE: ${snapshot.title}`);
  header.push(
    `PAGE STATE: readyState=${snapshot.stability.readyState}, pendingRequests=${snapshot.stability.pendingRequestCount}`,
  );
  header.push(`INTERACTIVE ELEMENTS (${snapshot.elements.length} total, showing up to ${limit}):`);

  const lines: string[] = [...header];
  let running = lines.join("\n").length;
  let renderedCount = 0;

  for (const el of snapshot.elements.slice(0, limit)) {
    const line = renderElementLine(el, fieldChars);

    if (running + line.length + 1 > totalCap) {
      const remaining = snapshot.elements.length - renderedCount;
      lines.push(`... ${remaining} more truncated`);
      return lines.join("\n");
    }
    lines.push(line);
    running += line.length + 1;
    renderedCount += 1;
  }

  if (snapshot.elements.length > limit) {
    lines.push(`... ${snapshot.elements.length - limit} more elements truncated`);
  }

  return lines.join("\n");
}

/**
 * Diff-aware variant of {@link formatSnapshotForLLM}.
 *
 * Returns a compact summary of element-level deltas:
 *
 *   + @eN [role] "name"<state>     (added)
 *   - @eM                           (removed)
 *   ~ @eK [role] "newname"<state>   (changed)
 *   (= 47 unchanged)
 *
 * Falls back to the full snapshot when:
 *   - prev is null
 *   - the URL changed between snapshots
 *   - more than 50% of `next`'s elements are added/removed/changed
 *   - the rendered diff would exceed `maxTotalChars`
 *
 * The fallback path returns the same string `formatSnapshotForLLM(next)`
 * would, with `usedDiff: false`.
 */
export function formatSnapshotDiff(
  prev: PageSnapshot | null,
  next: PageSnapshot,
  budgetsOrLimit?: DomBudgetOptions | number,
): { text: string; usedDiff: boolean } {
  if (!prev || prev.url !== next.url) {
    return { text: formatSnapshotForLLM(next, budgetsOrLimit), usedDiff: false };
  }

  const budgets: RequiredDomBudgets =
    typeof budgetsOrLimit === "number"
      ? withBudgetDefaults({ maxDisplayElements: budgetsOrLimit })
      : withBudgetDefaults(budgetsOrLimit);
  const limit = budgets.maxDisplayElements;
  const fieldChars = budgets.maxFieldChars;
  const totalCap = budgets.maxTotalChars;

  const diff = diffSnapshots(prev, next);
  const churn = diff.added.length + diff.removed.length + diff.changed.length;
  const denom = Math.max(1, next.elements.length);
  if (churn / denom > 0.5) {
    return { text: formatSnapshotForLLM(next, budgetsOrLimit), usedDiff: false };
  }

  const header: string[] = [];
  header.push(`URL: ${next.url}`);
  header.push(`TITLE: ${next.title}`);
  header.push(
    `PAGE STATE: readyState=${next.stability.readyState}, pendingRequests=${next.stability.pendingRequestCount}`,
  );
  header.push(
    `SNAPSHOT DIFF vs prior step: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.changed.length} changed, =${diff.unchanged} unchanged.`,
  );

  const lines: string[] = [...header];
  let renderedDiffLines = 0;
  let omittedDiffLines = 0;

  const pushDiffLine = (line: string): void => {
    if (renderedDiffLines >= limit) {
      omittedDiffLines += 1;
      return;
    }
    lines.push(line);
    renderedDiffLines += 1;
  };

  for (const el of diff.added) pushDiffLine(`+ ${renderElementLine(el, fieldChars)}`);
  for (const el of diff.removed) pushDiffLine(`- @e${el.index}`);
  for (const ch of diff.changed) pushDiffLine(`~ ${renderElementLine(ch.next, fieldChars)}`);
  if (omittedDiffLines > 0) {
    lines.push(`... ${omittedDiffLines} diff entries truncated`);
  }
  lines.push(`(= ${diff.unchanged} unchanged)`);

  const text = lines.join("\n");
  if (text.length > totalCap) {
    return { text: formatSnapshotForLLM(next, budgetsOrLimit), usedDiff: false };
  }
  return { text, usedDiff: true };
}
