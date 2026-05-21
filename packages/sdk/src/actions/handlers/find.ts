import type { ElementInfo } from "../../dom/types";
import type { Action } from "../types";
import { fail, ok, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function visible(elements: readonly ElementInfo[]): readonly ElementInfo[] {
  return elements.filter((el) => el.bbox.w > 0 && el.bbox.h > 0);
}

function summarize(found: readonly ElementInfo[]): {
  indices: number[];
  preview: Array<{ index: number; tag: string; text: string; stableId: string }>;
} {
  const indices = found.map((m) => m.index);
  const preview = found.slice(0, 20).map((m) => ({
    index: m.index,
    tag: m.tag,
    text: (m.axName ?? m.ariaName ?? m.text ?? "").slice(0, 100),
    stableId: m.stableId,
  }));
  return { indices, preview };
}

function textMatches(haystack: string, needle: string, partial: boolean): boolean {
  if (partial) return haystack.includes(needle);
  return haystack === needle;
}

export function handleFindByRole(
  ctx: HandlerContext,
  action: ByName<"find_by_role">,
): ActionResult {
  const elements = visible(ctx.snapshotElements ?? []);
  if (elements.length === 0) return fail("No snapshot elements available.");
  const roleNeedle = norm(action.params.role);
  const nameNeedle = action.params.name ? norm(action.params.name) : null;
  const partial = action.params.partial === true;
  const found = elements.filter((el) => {
    const role = norm(el.axRole ?? el.role);
    if (role !== roleNeedle) return false;
    if (!nameNeedle) return true;
    const name = norm(el.axName ?? el.ariaName ?? el.text);
    return textMatches(name, nameNeedle, partial);
  });
  const summary = summarize(found);
  return ok(
    `find_by_role(${action.params.role}${action.params.name ? `, ${action.params.name}` : ""}): ${found.length} match(es)`,
    { data: summary },
  );
}

export function handleFindByText(
  ctx: HandlerContext,
  action: ByName<"find_by_text">,
): ActionResult {
  const elements = visible(ctx.snapshotElements ?? []);
  if (elements.length === 0) return fail("No snapshot elements available.");
  const needle = norm(action.params.text);
  const partial = action.params.partial === true;
  const found = elements.filter(
    (el) =>
      textMatches(norm(el.text), needle, partial) || textMatches(norm(el.axName), needle, partial),
  );
  const summary = summarize(found);
  return ok(`find_by_text(${action.params.text}): ${found.length} match(es)`, { data: summary });
}

export function handleFindByTestid(
  ctx: HandlerContext,
  action: ByName<"find_by_testid">,
): ActionResult {
  const elements = visible(ctx.snapshotElements ?? []);
  if (elements.length === 0) return fail("No snapshot elements available.");
  const found = elements.filter((el) => el.testId === action.params.testid);
  const summary = summarize(found);
  return ok(`find_by_testid(${action.params.testid}): ${found.length} match(es)`, {
    data: summary,
  });
}
