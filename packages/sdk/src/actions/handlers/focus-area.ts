import type { ElementBBox, ElementInfo } from "../../dom/types";
import type { Action } from "../types";
import { fail, ok, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

const FORM_TAGS = new Set(["input", "textarea", "select"]);

function expandBbox(b: ElementBBox, pad: number): ElementBBox {
  return { x: b.x - pad, y: b.y - pad, w: b.w + 2 * pad, h: b.h + 2 * pad };
}

function unionBbox(elements: readonly ElementInfo[]): ElementBBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const el of elements) {
    if (el.bbox.w <= 0 || el.bbox.h <= 0) continue;
    x0 = Math.min(x0, el.bbox.x);
    y0 = Math.min(y0, el.bbox.y);
    x1 = Math.max(x1, el.bbox.x + el.bbox.w);
    y1 = Math.max(y1, el.bbox.y + el.bbox.h);
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function scoreElementAgainstQuery(el: ElementInfo, terms: readonly string[]): number {
  const haystack = [
    el.ariaName,
    el.ariaLabel,
    el.placeholder,
    el.name,
    el.text,
    el.role,
    el.type,
    el.tag,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  let score = 0;
  for (const t of terms) {
    if (t && haystack.includes(t)) score += 1;
  }
  return score;
}

function inferIntent(query: string): "form" | "results" | "sort" | null {
  const q = query.toLowerCase();
  if (q.includes("form") || q.includes("search") || q.includes("login") || q.includes("sign in"))
    return "form";
  if (q.includes("result") || q.includes("list") || q.includes("listing")) return "results";
  if (q.includes("sort") || q.includes("filter")) return "sort";
  return null;
}

function pickFocusElements(
  elements: readonly ElementInfo[],
  query: string,
): { bbox: ElementBBox; reason: string; matchCount: number } | null {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0 || elements.length === 0) return null;

  const intent = inferIntent(query);
  const visible = elements.filter((el) => el.bbox.w > 0 && el.bbox.h > 0);
  if (visible.length === 0) return null;

  const scored = visible
    .map((el) => ({ el, score: scoreElementAgainstQuery(el, terms) }))
    .filter((s) => s.score > 0)
    .toSorted((a, b) => b.score - a.score);

  if (scored.length === 0 && intent === null) return null;

  const seed =
    scored[0]?.el ??
    (intent === "form" ? visible.find((el) => FORM_TAGS.has(el.tag.toLowerCase())) : undefined) ??
    null;
  if (!seed) return null;

  // Cluster: anything within 200px vertical of seed (covers booking-style
  // multi-input search rows). Horizontal band is implicit via expandBbox pad.
  const seedCenterY = seed.bbox.y + seed.bbox.h / 2;
  const cluster = visible.filter((el) => {
    const cy = el.bbox.y + el.bbox.h / 2;
    return Math.abs(cy - seedCenterY) < 200;
  });

  const bbox = expandBbox(unionBbox(cluster.length > 0 ? cluster : [seed]), 40);
  return {
    bbox,
    reason: `seed=[${seed.index}] ${seed.tag}${seed.type ? `/${seed.type}` : ""} "${(seed.ariaName ?? seed.ariaLabel ?? seed.placeholder ?? seed.text ?? "").slice(0, 60)}"`,
    matchCount: cluster.length,
  };
}

export function handleFocusArea(ctx: HandlerContext, action: ByName<"focus_area">): ActionResult {
  const focus = ctx.focusState;
  if (!focus) {
    return fail("focus_area requires focus state (internal wiring error)");
  }
  if (
    action.params.clear ||
    !action.params.query.trim() ||
    action.params.query.trim().toLowerCase() === "clear"
  ) {
    focus.clear();
    return ok("Focus cleared. Future observations will show the full page.");
  }
  const elements = ctx.snapshotElements ?? [];
  const pick = pickFocusElements(elements, action.params.query);
  if (!pick) {
    return fail(
      `Could not match any visible elements to query "${action.params.query}". Try a different phrase or call focus_area with clear=true.`,
    );
  }
  focus.set({
    bbox: pick.bbox,
    reason: `${action.params.query} :: ${pick.reason}`,
    pageUrl: ctx.currentUrl ?? "",
    setAtStep: ctx.currentStep ?? 0,
  });
  return ok(
    `Focus set to bbox(${Math.round(pick.bbox.x)},${Math.round(pick.bbox.y)},${Math.round(pick.bbox.w)}×${Math.round(pick.bbox.h)}) matching "${action.params.query}". ${pick.matchCount} elements inside; next observation will be filtered to this region.`,
  );
}
