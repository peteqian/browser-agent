import type { Action } from "../types";
import {
  fail,
  ok,
  resolveBackendId,
  type ActionResult,
  type HandlerContext,
} from "./shared";

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
  if (action.params.fileName) {
    const savedPath = await ctx.page.screenshotToFile(action.params.fileName);
    return ok(`Screenshot saved to ${savedPath}`, { data: { path: savedPath } });
  }
  const base64 = await ctx.page.screenshot();
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
    `<url>\n${result.url}\n</url>\n<query>\n${result.query}\n</query>\n` +
    `<result>\n${result.content}\n</result>`;
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

export function handleDone(
  _ctx: HandlerContext,
  action: ByName<"done">,
): ActionResult {
  return ok(`Done (success=${action.params.success}): ${action.params.summary}`, {
    longTermMemory: action.params.summary,
  });
}
