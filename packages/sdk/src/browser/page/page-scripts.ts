import type { Page } from "./page";
import { AD_DOMAINS } from "../session/session-helpers";
import type {
  ExtractContentParams,
  ExtractContentResult,
  FindElementsParams,
  PendingNetworkRequest,
  SearchPageParams,
} from "../session/session-types";

export async function readLocalStorage(page: Page): Promise<Record<string, string>> {
  return page.evaluate<Record<string, string>>(`(() => {
    const values = {};
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key == null) continue;
      values[key] = localStorage.getItem(key) ?? "";
    }
    return values;
  })()`);
}

export async function origin(page: Page): Promise<string> {
  return page.evaluate<string>("location.origin");
}

export async function getPendingNetworkRequests(
  page: Page,
  limit = 20,
): Promise<PendingNetworkRequest[]> {
  const data = await page.evaluate<{
    pending_requests: Array<{
      url: string;
      method?: string;
      loading_duration_ms?: number;
      resource_type?: string;
    }>;
  }>(`(() => {
    const now = performance.now();
    const resources = performance.getEntriesByType('resource');
    const pending = [];
    const adDomains = ${JSON.stringify(AD_DOMAINS)};

    for (const entry of resources) {
      if (entry.responseEnd !== 0) continue;
      const url = entry.name;
      if (adDomains.some((domain) => url.includes(domain))) continue;
      if (url.startsWith('data:') || url.length > 500) continue;

      const loadingDuration = now - entry.startTime;
      if (loadingDuration > 10000) continue;

      const resourceType = entry.initiatorType || 'unknown';
      const nonCriticalTypes = ['img', 'image', 'icon', 'font'];
      if (nonCriticalTypes.includes(resourceType) && loadingDuration > 3000) continue;
      if (/\\.(jpg|jpeg|png|gif|webp|svg|ico)(\\?|$)/i.test(url) && loadingDuration > 3000) continue;

      pending.push({
        url,
        method: 'GET',
        loading_duration_ms: Math.round(loadingDuration),
        resource_type: resourceType,
      });
    }

    return { pending_requests: pending };
  })()`);

  return (data.pending_requests ?? []).slice(0, limit).map((req) => ({
    url: req.url,
    method: req.method ?? "GET",
    loadingDurationMs: req.loading_duration_ms ?? 0,
    resourceType: req.resource_type ?? "unknown",
  }));
}

export async function searchPage(
  page: Page,
  params: SearchPageParams,
): Promise<{
  total: number;
  hasMore: boolean;
  matches: Array<{
    matchText: string;
    context: string;
    elementPath: string;
    charPosition: number;
  }>;
}> {
  const payload = {
    pattern: params.pattern,
    regex: params.regex ?? false,
    caseSensitive: params.caseSensitive ?? false,
    contextChars: params.contextChars ?? 150,
    cssScope: params.cssScope ?? null,
    maxResults: params.maxResults ?? 25,
  };

  return page.evaluate(`(() => {
    const p = ${JSON.stringify(payload)};
    const scope = p.cssScope ? document.querySelector(p.cssScope) : document.body;
    if (!scope) return { total: 0, hasMore: false, matches: [] };

    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    let fullText = "";
    const nodeOffsets = [];
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent || "";
      if (!text.trim()) continue;
      nodeOffsets.push({ offset: fullText.length, length: text.length, node });
      fullText += text;
    }

    let re;
    try {
      const flags = p.caseSensitive ? 'g' : 'gi';
      const escapeRegex = (v) => {
        let out = '';
        const specials = '.*+?^$()|[]\\\\';
        for (const ch of String(v)) {
          if (specials.includes(ch)) out += '\\\\' + ch;
          else out += ch;
        }
        return out;
      };
      re = p.regex ? new RegExp(p.pattern, flags) : new RegExp(escapeRegex(p.pattern), flags);
    } catch {
      return { total: 0, hasMore: false, matches: [] };
    }

    const matches = [];
    let total = 0;
    let match;
    while ((match = re.exec(fullText)) !== null) {
      total += 1;
      if (matches.length < p.maxResults) {
        const start = Math.max(0, match.index - p.contextChars);
        const end = Math.min(fullText.length, match.index + match[0].length + p.contextChars);
        const context = (start > 0 ? '...' : '') + fullText.slice(start, end) + (end < fullText.length ? '...' : '');

        let elementPath = '';
        for (const offset of nodeOffsets) {
          if (offset.offset <= match.index && offset.offset + offset.length > match.index) {
            const el = offset.node.parentElement;
            const parts = [];
            let current = el;
            while (current && current !== document.body && current !== document.documentElement) {
              let desc = current.tagName.toLowerCase();
              if (current.id) desc += '#' + current.id;
              parts.unshift(desc);
              current = current.parentElement;
            }
            elementPath = parts.join(' > ');
            break;
          }
        }

        matches.push({
          matchText: match[0],
          context,
          elementPath,
          charPosition: match.index,
        });
      }

      if (match[0].length === 0) re.lastIndex += 1;
    }

    return { total, hasMore: total > p.maxResults, matches };
  })()`);
}

export async function findElements(
  page: Page,
  params: FindElementsParams,
): Promise<{
  total: number;
  showing: number;
  elements: Array<{
    index: number;
    tag: string;
    text?: string;
    attrs?: Record<string, string>;
    childrenCount: number;
  }>;
}> {
  const payload = {
    selector: params.selector,
    attributes: params.attributes ?? null,
    maxResults: params.maxResults ?? 50,
    includeText: params.includeText ?? true,
  };

  return page.evaluate(`(() => {
    const p = ${JSON.stringify(payload)};
    let nodeList;
    try {
      nodeList = document.querySelectorAll(p.selector);
    } catch {
      return { total: 0, showing: 0, elements: [] };
    }

    const total = nodeList.length;
    const showing = Math.min(total, p.maxResults);
    const elements = [];
    for (let i = 0; i < showing; i += 1) {
      const el = nodeList[i];
      const item = {
        index: i,
        tag: el.tagName.toLowerCase(),
        childrenCount: el.children.length,
      };
      if (p.includeText) {
        const text = (el.textContent || '').trim();
        item.text = text.length > 300 ? text.slice(0, 300) + '...' : text;
      }
      if (Array.isArray(p.attributes) && p.attributes.length > 0) {
        item.attrs = {};
        for (const attr of p.attributes) {
          const val = (attr === 'src' || attr === 'href') && typeof el[attr] === 'string' ? el[attr] : el.getAttribute(attr);
          if (val != null) {
            item.attrs[attr] = val.length > 500 ? val.slice(0, 500) + '...' : val;
          }
        }
      }
      elements.push(item);
    }

    return { total, showing, elements };
  })()`);
}

export async function extractContent(
  page: Page,
  params: ExtractContentParams,
): Promise<ExtractContentResult> {
  const payload = {
    query: params.query,
    extractLinks: params.extractLinks ?? false,
    extractImages: params.extractImages ?? false,
    startFromChar: params.startFromChar ?? 0,
    maxChars: params.maxChars ?? 100_000,
    alreadyCollected: params.alreadyCollected ?? [],
  };

  return page.evaluate(`(() => {
    const p = ${JSON.stringify(payload)};
    const title = (document.title || '').trim();
    const url = location.href;
    const body = document.body;

    const lines = [];
    const collapseWhitespace = (value) => {
      let out = '';
      let previousWasSpace = false;
      for (const ch of String(value || '')) {
        const isSpace = ch === ' ' || ch === '\\n' || ch === '\\r' || ch === '\\t' || ch === '\\f';
        if (isSpace) {
          if (!previousWasSpace) {
            out += ' ';
            previousWasSpace = true;
          }
        } else {
          out += ch;
          previousWasSpace = false;
        }
      }
      return out.trim();
    };

    if (title) lines.push('# ' + title, '');

    const text = (body?.innerText || '').replace(/\\n{3,}/g, '\\n\\n').trim();
    if (text) lines.push(text);

    const linkEntries = [];
    if (p.extractLinks && body) {
      const seen = new Set();
      const skipSet = new Set(p.alreadyCollected || []);
      for (const a of Array.from(body.querySelectorAll('a[href]'))) {
        const href = (a.getAttribute('href') || '').trim();
        if (!href) continue;
        const absHref = (() => {
          try { return new URL(href, location.href).toString(); }
          catch { return href; }
        })();
        if (seen.has(absHref)) continue;
        if (skipSet.has(absHref)) continue;
        seen.add(absHref);
        const label = collapseWhitespace(a.textContent || a.getAttribute('aria-label') || '');
        linkEntries.push({ href: absHref, text: label || absHref });
      }
    }

    const imageEntries = [];
    if (p.extractImages && body) {
      const seen = new Set();
      for (const img of Array.from(body.querySelectorAll('img[src]'))) {
        const src = (img.getAttribute('src') || '').trim();
        if (!src) continue;
        const absSrc = (() => {
          try { return new URL(src, location.href).toString(); }
          catch { return src; }
        })();
        if (seen.has(absSrc)) continue;
        seen.add(absSrc);
        const alt = collapseWhitespace(img.getAttribute('alt') || '');
        imageEntries.push({ src: absSrc, alt });
      }
    }

    if (linkEntries.length > 0) {
      lines.push('', '## Links', '');
      for (const item of linkEntries) {
        lines.push('- [' + item.text + '](' + item.href + ')');
      }
    }

    if (imageEntries.length > 0) {
      lines.push('', '## Images', '');
      for (const item of imageEntries) {
        lines.push('- ![' + (item.alt || 'image') + '](' + item.src + ')');
      }
    }

    const fullContent = lines.join('\\n').trim();
    const totalChars = fullContent.length;
    const start = Math.min(Math.max(0, p.startFromChar), totalChars);
    const end = Math.min(totalChars, start + p.maxChars);
    const chunk = fullContent.slice(start, end);
    const truncated = end < totalChars;

    return {
      url,
      query: p.query,
      content: chunk,
      stats: {
        totalChars,
        startFromChar: start,
        returnedChars: chunk.length,
        truncated,
        nextStartChar: truncated ? end : null,
        linksCount: linkEntries.length,
        imagesCount: imageEntries.length,
      },
    };
  })()`);
}
