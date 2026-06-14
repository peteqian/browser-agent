import type { Action } from "../types";
import {
  fail,
  ok,
  resolveActionPage,
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
  const options = await resolveActionPage(ctx, resolved.targetId).getDropdownOptionsByBackendNodeId(
    resolved.backendNodeId,
  );
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

interface ExtractMemo {
  query: string;
  url: string;
  digest: string;
  hits: number;
}

const extractMemoByPage = new WeakMap<object, ExtractMemo>();

function digestContent(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return hash.toString(16);
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

  const digest = digestContent(result.content);
  const memo = extractMemoByPage.get(ctx.page as unknown as object);
  const isRepeat =
    memo && memo.url === result.url && memo.digest === digest && memo.query === action.params.query;
  if (isRepeat && memo) {
    memo.hits += 1;
    if (memo.hits >= 2) {
      return fail(
        `extract_content returned identical content for this URL. ` +
          `You already have this data in prior history — do not re-extract here. ` +
          `Move to your next planned step (click, navigate, change sort) or emit done.`,
        {
          longTermMemory: "Duplicate extract_content; advance to next step",
          data: { duplicateExtraction: true, query: result.query, digest },
        },
      );
    }
  } else {
    extractMemoByPage.set(ctx.page as unknown as object, {
      query: action.params.query,
      url: result.url,
      digest,
      hits: 1,
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
