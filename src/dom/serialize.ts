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
  header.push(`INTERACTIVE ELEMENTS (${snapshot.elements.length} total, showing up to ${limit}):`);

  const lines: string[] = [...header];
  let running = lines.join("\n").length;
  let renderedCount = 0;

  for (const el of snapshot.elements.slice(0, limit)) {
    const attrs: string[] = [];
    attrs.push(`frame=${truncate(el.framePath, 50)}`);
    attrs.push(`selector=${truncate(el.selectorHint, 50)}`);
    if (el.role) attrs.push(`role=${truncate(el.role, 30)}`);
    if (el.type) attrs.push(`type=${el.type}`);
    if (el.name) attrs.push(`name=${truncate(el.name, fieldChars)}`);
    if (el.ariaName) attrs.push(`a11y=${truncate(el.ariaName, fieldChars)}`);
    if (el.href) attrs.push(`href=${truncate(el.href, 80)}`);
    if (el.placeholder) attrs.push(`placeholder=${truncate(el.placeholder, fieldChars)}`);
    if (el.ariaLabel) attrs.push(`aria=${truncate(el.ariaLabel, fieldChars)}`);
    const attrStr = attrs.length > 0 ? ` [${attrs.join(" ")}]` : "";
    const text = el.text ? ` "${truncate(el.text, textChars)}"` : "";
    const line = `[${el.index}] <${el.tag}>${attrStr}${text}`;

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
