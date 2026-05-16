import type { BrowserSession, Page } from "../../browser/session";
import type { SelectorMap } from "../../dom/cdp-snapshot";
import type { Action } from "../types";
import type { ExtractionLLMFn } from "../../agent/contracts";

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
): { ok: true; backendNodeId: number } | { ok: false; message: string } {
  if (!selectorMap) {
    return { ok: false, message: `Index [${index}] is not present in the current snapshot` };
  }
  const entry = selectorMap.byIndex.get(index);
  if (!entry) {
    return { ok: false, message: `Index [${index}] is not present in the current snapshot` };
  }
  return { ok: true, backendNodeId: entry.backendNodeId };
}

export function staleMessage(index: number): string {
  return `Element [${index}] no longer exists in the DOM`;
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
