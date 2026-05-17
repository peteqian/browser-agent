import type { Page } from "../browser/session";
import {
  captureCdpSnapshot,
  withBudgetDefaults,
  type DomBudgetOptions,
  type RequiredDomBudgets,
  type SelectorMap,
} from "./cdp-snapshot";
import type { PageSnapshot } from "./types";

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

/**
 * Render an element line that leads with the strongest stable handle and
 * keeps `[index]` as a fallback identifier. Builders should prefer the
 * stable handle when targeting elements; the index is only valid for the
 * current snapshot.
 */
function renderElementLine(
  el: import("./types").ElementInfo,
  fieldChars: number,
  textChars: number,
): string {
  const handle = el.stableHandle.value;
  const tag = `<${el.tag}${el.type ? `/${el.type}` : ""}>`;
  // Extra fields appended only when not already encoded in the handle.
  const extras: string[] = [];
  if (el.stableHandle.kind !== "testid" && el.testId)
    extras.push(`testid="${truncate(el.testId, 60)}"`);
  if (el.stableHandle.kind !== "role" && el.axRole && el.axName)
    extras.push(`role=${truncate(el.axRole, 30)} name="${truncate(el.axName, fieldChars)}"`);
  if (
    el.stableHandle.kind !== "label" &&
    el.labelText &&
    (el.tag === "input" || el.tag === "textarea" || el.tag === "select")
  ) {
    extras.push(`label="${truncate(el.labelText, fieldChars)}"`);
  }
  if (el.value && el.tag !== "button") extras.push(`value="${truncate(el.value, fieldChars)}"`);
  if (el.stableHandle.kind !== "href" && el.href && el.tag === "a")
    extras.push(`href="${truncate(el.href, 80)}"`);
  if (
    el.stableHandle.kind !== "text" &&
    el.text &&
    el.stableHandle.kind === "index" &&
    !el.testId &&
    !(el.axRole && el.axName)
  ) {
    extras.push(`text="${truncate(el.text, textChars)}"`);
  }
  const handlePart = handle ? `${handle} ` : "";
  const extrasPart = extras.length > 0 ? ` ${extras.join(" ")}` : "";
  return `${handlePart}${tag}${extrasPart} [${el.index}]#${el.stableId}`;
}

const FORM_FIELD_TAGS = new Set(["input", "textarea", "select"]);
const FORM_BUTTON_TYPES = new Set(["submit", "button"]);

function isLikelyFormField(el: import("./types").ElementInfo): boolean {
  if (el.bbox.w <= 0 || el.bbox.h <= 0) return false;
  const tag = el.tag.toLowerCase();
  if (FORM_FIELD_TAGS.has(tag)) {
    // Skip hidden inputs.
    return el.type !== "hidden";
  }
  if (tag === "button") {
    return el.type === null || FORM_BUTTON_TYPES.has(el.type);
  }
  if (el.role === "combobox" || el.role === "searchbox" || el.role === "textbox") return true;
  return false;
}

function fieldLabel(el: import("./types").ElementInfo, max: number): string {
  const label = el.ariaName ?? el.ariaLabel ?? el.placeholder ?? el.name ?? el.text ?? "";
  return truncate(label.trim(), max);
}

function clusterFormGroups(
  fields: readonly import("./types").ElementInfo[],
  gapPx: number,
): import("./types").ElementInfo[][] {
  if (fields.length === 0) return [];
  const sorted = fields.toSorted((a, b) => a.bbox.y - b.bbox.y || a.bbox.x - b.bbox.x);
  const groups: import("./types").ElementInfo[][] = [[sorted[0] as (typeof sorted)[number]]];
  for (let i = 1; i < sorted.length; i += 1) {
    const cur = sorted[i] as (typeof sorted)[number];
    const tail = groups[groups.length - 1] as import("./types").ElementInfo[];
    // Compare against the lowest member of the current group so wide forms
    // (multiple inputs side-by-side) stay together even when individual y's
    // jitter.
    const groupBottom = Math.max(...tail.map((el) => el.bbox.y + el.bbox.h));
    const yGap = cur.bbox.y - groupBottom;
    if (yGap < gapPx) tail.push(cur);
    else groups.push([cur]);
  }
  return groups;
}

function buildFormPrelude(
  elements: readonly import("./types").ElementInfo[],
  fieldChars: number,
  maxFields: number,
): string[] {
  const fields = elements.filter(isLikelyFormField);
  if (fields.length === 0) return [];
  const groups = clusterFormGroups(fields, 120);
  // Keep groups with at least one true input/select/textarea — pure-button
  // clusters (e.g. nav bars, footer rows) are not really forms.
  const formGroups = groups.filter((g) =>
    g.some((el) => FORM_FIELD_TAGS.has(el.tag.toLowerCase())),
  );
  if (formGroups.length === 0) return [];
  const lines: string[] = [
    `FORMS DETECTED (${formGroups.length}) — prefer these indices for any data-entry/search task.`,
    "Page regions (heuristic): y<120=HEADER (nav/search bar), 120-700=MAIN (primary content), y>700=FOOTER. Main forms are usually the answer for search/filter tasks.",
  ];
  let printed = 0;
  for (let gi = 0; gi < formGroups.length; gi += 1) {
    const group = formGroups[gi] as import("./types").ElementInfo[];
    const top = Math.round(group[0]?.bbox.y ?? 0);
    const region = top < 120 ? "HEADER" : top > 700 ? "FOOTER" : "MAIN";
    lines.push(
      `  form#${gi + 1} [${region}] @y≈${top} (${group.length} field${group.length === 1 ? "" : "s"}):`,
    );
    for (const el of group) {
      if (printed >= maxFields) {
        lines.push(`    ... ${fields.length - printed} more form fields truncated`);
        return lines;
      }
      const handle = el.stableHandle.value;
      const type = el.type ? `/${el.type}` : "";
      const value = el.value ? ` value="${truncate(el.value, fieldChars)}"` : "";
      const fallbackLabel =
        el.stableHandle.kind === "index" ? ` label="${fieldLabel(el, fieldChars)}"` : "";
      lines.push(
        `    ${handle ? `${handle} ` : ""}<${el.tag}${type}>${fallbackLabel}${value} [${el.index}]`,
      );
      printed += 1;
    }
  }
  return lines;
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
  const textChars = budgets.maxTextChars;
  const totalCap = budgets.maxTotalChars;

  const header: string[] = [];
  header.push(`URL: ${snapshot.url}`);
  header.push(`TITLE: ${snapshot.title}`);
  header.push(
    `PAGE STATE: readyState=${snapshot.stability.readyState}, pendingRequests=${snapshot.stability.pendingRequestCount}`,
  );
  const formPrelude = buildFormPrelude(snapshot.elements, fieldChars, 30);
  header.push(...formPrelude);
  header.push(`INTERACTIVE ELEMENTS (${snapshot.elements.length} total, showing up to ${limit}):`);

  const lines: string[] = [...header];
  let running = lines.join("\n").length;
  let renderedCount = 0;

  for (const el of snapshot.elements.slice(0, limit)) {
    const line = renderElementLine(el, fieldChars, textChars);

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
