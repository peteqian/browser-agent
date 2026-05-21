import type { ElementBBox, ElementInfo } from "../../dom/types";
import type { Action } from "../types";
import { fail, ok, resolveBackendId, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

function formatSearchResults(
  data: {
    total: number;
    hasMore: boolean;
    matches: Array<{
      matchText: string;
      context: string;
      elementPath: string;
      charPosition: number;
    }>;
  },
  pattern: string,
): string {
  const { total, matches } = data;
  if (total === 0) return `No matches found for "${pattern}" on page.`;

  const lines: string[] = [
    `Found ${total} match${total !== 1 ? "es" : ""} for "${pattern}" on page:`,
    "",
  ];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i] as (typeof matches)[number];
    const loc = m.elementPath ? ` (in ${m.elementPath})` : "";
    lines.push(`[${i + 1}] ${m.context}${loc}`);
  }
  if (data.hasMore) {
    lines.push(
      "",
      `... showing ${matches.length} of ${total} total matches. Increase max_results to see more.`,
    );
  }
  return lines.join("\n");
}

function formatFindResults(
  data: {
    total: number;
    showing: number;
    elements: Array<{
      index: number;
      tag: string;
      text?: string;
      attrs?: Record<string, string>;
      childrenCount: number;
    }>;
  },
  selector: string,
): string {
  const total = data.total;
  if (total === 0) return `No elements found matching "${selector}".`;

  const lines: string[] = [
    `Found ${total} element${total !== 1 ? "s" : ""} matching "${selector}":`,
    "",
  ];
  for (const el of data.elements) {
    const parts: string[] = [`[${el.index}] <${el.tag}>`];
    if (el.text) {
      const display = el.text.split(/\s+/).join(" ").trim().slice(0, 120);
      if (display) parts.push(`"${display}${el.text.length > 120 ? "..." : ""}"`);
    }
    if (el.attrs && Object.keys(el.attrs).length > 0) {
      const attrs = Object.entries(el.attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(", ");
      parts.push(`{${attrs}}`);
    }
    parts.push(`(${el.childrenCount} children)`);
    lines.push(parts.join(" "));
  }
  if (data.showing < total) {
    lines.push(
      "",
      `Showing ${data.showing} of ${total} total elements. Increase max_results to see more.`,
    );
  }
  return lines.join("\n");
}

export async function handleSearchPage(
  ctx: HandlerContext,
  action: ByName<"search_page">,
): Promise<ActionResult> {
  const result = await ctx.page.searchPage({
    pattern: action.params.pattern,
    regex: action.params.regex,
    caseSensitive: action.params.caseSensitive,
    contextChars: action.params.contextChars,
    cssScope: action.params.cssScope,
    maxResults: action.params.maxResults,
  });
  const formatted = formatSearchResults(result, action.params.pattern);
  return ok(formatted, {
    longTermMemory: `Searched page for "${action.params.pattern}": ${result.total} match${result.total === 1 ? "" : "es"} found.`,
    data: result,
  });
}

export async function handleFindElements(
  ctx: HandlerContext,
  action: ByName<"find_elements">,
): Promise<ActionResult> {
  const result = await ctx.page.findElements({
    selector: action.params.selector,
    attributes: action.params.attributes,
    maxResults: action.params.maxResults,
    includeText: action.params.includeText,
  });
  const formatted = formatFindResults(result, action.params.selector);
  return ok(formatted, {
    longTermMemory: `Found ${result.total} element${result.total === 1 ? "" : "s"} matching "${action.params.selector}".`,
    data: result,
  });
}

export async function handleGetDropdownOptions(
  ctx: HandlerContext,
  action: ByName<"get_dropdown_options">,
): Promise<ActionResult> {
  const resolved = resolveBackendId(ctx.selectorMap, action.params.index);
  if (!resolved.ok) return fail(resolved.message);
  const options = await ctx.page.getDropdownOptionsByBackendNodeId(resolved.backendNodeId);
  const optionsText =
    options.length === 0
      ? `No dropdown options found at [${action.params.index}]`
      : [
          `Dropdown options at [${action.params.index}]:`,
          "",
          ...options.map((o, i) => `[${i + 1}] text="${o.text}" value="${o.value}"`),
        ].join("\n");
  return ok(optionsText, {
    longTermMemory: `Read ${options.length} dropdown option${options.length === 1 ? "" : "s"} from [${action.params.index}]`,
    data: { index: action.params.index, options },
  });
}

export async function handleFindText(
  ctx: HandlerContext,
  action: ByName<"find_text">,
): Promise<ActionResult> {
  const found = await ctx.page.scrollToText(action.params.text);
  return found
    ? ok(`Scrolled to text: ${action.params.text}`, { longTermMemory: "Scrolled to target text" })
    : fail(`Text '${action.params.text}' not found or not visible on page`);
}

export async function handleScreenshot(
  ctx: HandlerContext,
  action: ByName<"screenshot">,
): Promise<ActionResult> {
  const annotate = action.params.annotate === true;
  const snapshot =
    annotate && ctx.snapshotElements
      ? {
          url: ctx.currentUrl ?? "",
          title: "",
          elements: [...ctx.snapshotElements],
          stability: { readyState: "complete", pendingRequestCount: 0 },
        }
      : undefined;
  const opts = annotate && snapshot ? { annotate: true, snapshot } : undefined;
  if (action.params.fileName) {
    const savedPath = await ctx.page.screenshotToFile(action.params.fileName, opts);
    return ok(`Screenshot saved to ${savedPath}`, { data: { path: savedPath } });
  }
  const base64 = await ctx.page.screenshot(opts);
  return ok("Captured screenshot (base64 PNG)", {
    longTermMemory: "Captured screenshot",
    data: { base64 },
  });
}

export async function handleSaveAsPdf(
  ctx: HandlerContext,
  action: ByName<"save_as_pdf">,
): Promise<ActionResult> {
  const path = await ctx.page.saveAsPdf({
    fileName: action.params.fileName,
    printBackground: action.params.printBackground,
    landscape: action.params.landscape,
    scale: action.params.scale,
    paperFormat: action.params.paperFormat,
  });
  return ok(`Saved page as PDF to ${path}`, { data: { path } });
}

function classifyExtractionError(message: string): "navigation_in_flight" | "timeout" | "unknown" {
  if (/execution context|context was destroyed|frame.*detached/i.test(message)) {
    return "navigation_in_flight";
  }
  if (/timeout/i.test(message)) return "timeout";
  return "unknown";
}

/**
 * Neutralizes attempts by extracted page text to close the `<url>`, `<query>`,
 * or `<result>` boundary tags that wrap extraction output. A page could
 * otherwise inject `</result>` followed by adversarial instructions and
 * tricks the model into treating them as tool output. We rewrite a literal
 * `</url>` (etc., case-insensitive) into `<-/url>` so the wrapper boundary
 * stays unique to our serialization.
 */
export function escapeExtractionBoundaries(text: string): string {
  return text.replace(/<\/(url|query|result)>/gi, "<-/$1>");
}

export async function handleExtractContent(
  ctx: HandlerContext,
  action: ByName<"extract_content">,
): Promise<ActionResult> {
  let result;
  try {
    result = await ctx.page.extractContent({
      query: action.params.query,
      extractLinks: action.params.extractLinks,
      extractImages: action.params.extractImages,
      startFromChar: action.params.startFromChar,
      maxChars: action.params.maxChars,
      alreadyCollected: action.params.alreadyCollected,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const reason = classifyExtractionError(message);
    return fail(`Extraction failed (${reason}): ${message}`, {
      longTermMemory: `Extraction failed: ${reason}`,
      data: { extractionError: { reason, message } },
    });
  }

  const wrapped =
    `<url>\n${escapeExtractionBoundaries(result.url)}\n</url>\n` +
    `<query>\n${escapeExtractionBoundaries(result.query)}\n</query>\n` +
    `<result>\n${escapeExtractionBoundaries(result.content)}\n</result>`;
  const statsMsg =
    `Extracted content for query "${action.params.query}": ` +
    `${result.stats.returnedChars}/${result.stats.totalChars} chars` +
    (result.stats.truncated && result.stats.nextStartChar != null
      ? ` (truncated, continue with startFromChar=${result.stats.nextStartChar})`
      : "");

  const data: Record<string, unknown> = { ...result };
  if (action.params.schemaJson && ctx.extractionLLM) {
    try {
      const hookResult = await ctx.extractionLLM({
        url: result.url,
        query: result.query,
        markdown: result.content,
        schemaJson: action.params.schemaJson,
        signal: ctx.signal,
      });
      data.structured = hookResult.data;
    } catch (err) {
      data.structuredError = err instanceof Error ? err.message : String(err);
    }
  }

  return ok(statsMsg, { extractedContent: wrapped, data });
}

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

function pickFocusElements(
  elements: readonly ElementInfo[],
  query: string,
): { bbox: ElementBBox; reason: string; matchCount: number } | null {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0 || elements.length === 0) return null;

  const intent = inferIntent(query);
  // Filter by visible elements only.
  const visible = elements.filter((el) => el.bbox.w > 0 && el.bbox.h > 0);
  if (visible.length === 0) return null;

  // Score each element against the query.
  const scored = visible
    .map((el) => ({ el, score: scoreElementAgainstQuery(el, terms) }))
    .filter((s) => s.score > 0)
    .toSorted((a, b) => b.score - a.score);

  if (scored.length === 0 && intent === null) return null;

  // Seed: top scored element, or first form-field if intent is "form".
  const seed =
    scored[0]?.el ??
    (intent === "form" ? visible.find((el) => FORM_TAGS.has(el.tag.toLowerCase())) : undefined) ??
    null;
  if (!seed) return null;

  // Cluster: include all elements whose bbox center is within 200px of seed
  // vertically AND within seed's horizontal band ±400px. Covers the typical
  // booking-style multi-input search row.
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

function inferIntent(query: string): "form" | "results" | "sort" | null {
  const q = query.toLowerCase();
  if (q.includes("form") || q.includes("search") || q.includes("login") || q.includes("sign in"))
    return "form";
  if (q.includes("result") || q.includes("list") || q.includes("listing")) return "results";
  if (q.includes("sort") || q.includes("filter")) return "sort";
  return null;
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

export async function handleEval(
  ctx: HandlerContext,
  action: ByName<"eval">,
): Promise<ActionResult> {
  try {
    const value = await ctx.page.evaluate<unknown>(action.params.expression);
    let serialized: string;
    try {
      serialized = JSON.stringify(value);
    } catch {
      serialized = String(value);
    }
    return ok(`eval result: ${serialized?.slice(0, 4000) ?? "undefined"}`, {
      longTermMemory: "Evaluated JS expression",
      data: { value: serialized },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return fail(`eval failed: ${message}`);
  }
}

export function handleDone(_ctx: HandlerContext, action: ByName<"done">): ActionResult {
  return ok(`Done (success=${action.params.success}): ${action.params.summary}`, {
    longTermMemory: action.params.summary,
  });
}
