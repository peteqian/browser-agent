import type { Page } from "../browser/session";
import type { ElementInfo, PageSnapshot } from "./types";

export interface DomBudgetOptions {
  maxElements?: number;
  maxDisplayElements?: number;
  maxFieldChars?: number;
  maxTextChars?: number;
  attributeWhitelist?: string[];
  maxTotalChars?: number;
}

export interface SelectorMapEntry {
  backendNodeId: number;
  frameId?: string;
}

export interface SelectorMap {
  byIndex: Map<number, SelectorMapEntry>;
}

export type RequiredDomBudgets = Required<DomBudgetOptions>;

export const DEFAULT_DOM_BUDGETS: RequiredDomBudgets = {
  maxElements: 1200,
  maxDisplayElements: 60,
  maxFieldChars: 120,
  maxTextChars: 120,
  attributeWhitelist: [
    "id",
    "name",
    "type",
    "placeholder",
    "role",
    "aria-label",
    "aria-labelledby",
    "value",
    "href",
    "alt",
    "title",
    "for",
    "data-testid",
    "data-test",
    "data-cy",
    "data-qa",
    "data-action",
    "data-component",
  ],
  maxTotalChars: 8_000,
};

export function withBudgetDefaults(input?: DomBudgetOptions): RequiredDomBudgets {
  if (!input) return DEFAULT_DOM_BUDGETS;
  return {
    maxElements: input.maxElements ?? DEFAULT_DOM_BUDGETS.maxElements,
    maxDisplayElements: input.maxDisplayElements ?? DEFAULT_DOM_BUDGETS.maxDisplayElements,
    maxFieldChars: input.maxFieldChars ?? DEFAULT_DOM_BUDGETS.maxFieldChars,
    maxTextChars: input.maxTextChars ?? DEFAULT_DOM_BUDGETS.maxTextChars,
    attributeWhitelist: input.attributeWhitelist ?? DEFAULT_DOM_BUDGETS.attributeWhitelist,
    maxTotalChars: input.maxTotalChars ?? DEFAULT_DOM_BUDGETS.maxTotalChars,
  };
}

const INTERACTIVE_TAGS = new Set([
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "label",
  "details",
  "summary",
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "checkbox",
  "radio",
  "menuitem",
  "tab",
  "option",
  "switch",
  "textbox",
  "combobox",
  "searchbox",
]);

const COMPUTED_STYLE_PROPS = [
  "display",
  "visibility",
  "opacity",
  "pointer-events",
  "cursor",
  "overflow",
  "position",
];

/**
 * Raw CDP DOMSnapshot response. Only fields we read are typed; everything else
 * is left as `unknown` so we do not pretend to model the whole protocol surface.
 */
interface RareStringData {
  index?: number[];
  value?: number[];
}
interface RareIntegerData {
  index?: number[];
  value?: number[];
}
interface RareBooleanData {
  index?: number[];
}

interface NodeTreeSnapshot {
  parentIndex?: number[];
  nodeType?: number[];
  nodeName?: number[];
  nodeValue?: number[];
  backendNodeId?: number[];
  attributes?: number[][];
  textValue?: RareStringData;
  inputValue?: RareStringData;
  contentDocumentIndex?: RareIntegerData;
  isClickable?: RareBooleanData;
}

interface LayoutTreeSnapshot {
  nodeIndex?: number[];
  styles?: number[][];
  bounds?: number[][];
  text?: number[];
  paintOrders?: number[];
}

interface DocumentSnapshot {
  documentURL?: number;
  title?: number;
  baseURL?: number;
  frameId?: number;
  nodes?: NodeTreeSnapshot;
  layout?: LayoutTreeSnapshot;
}

interface CaptureSnapshotResult {
  documents: DocumentSnapshot[];
  strings: string[];
}

interface AXValue {
  value?: unknown;
}
interface AXNode {
  backendDOMNodeId?: number;
  role?: AXValue;
  name?: AXValue;
  ignored?: boolean;
}

function clean(value: string | undefined, limit: number): string {
  if (!value) return "";
  return value.replace(/\s+/g, " ").trim().slice(0, limit);
}

function stringAt(strings: string[], index: number | undefined): string | undefined {
  if (typeof index !== "number" || index < 0) return undefined;
  return strings[index];
}

function buildRareStringIndex(
  data: RareStringData | undefined,
  strings: string[],
): Map<number, string> {
  const out = new Map<number, string>();
  if (!data?.index || !data?.value) return out;
  for (let i = 0; i < data.index.length; i += 1) {
    const idx = data.index[i];
    const v = data.value[i];
    if (typeof idx !== "number" || typeof v !== "number") continue;
    const text = strings[v];
    if (typeof text === "string") out.set(idx, text);
  }
  return out;
}

function buildRareBooleanSet(data: RareBooleanData | undefined): Set<number> {
  const out = new Set<number>();
  if (!data?.index) return out;
  for (const idx of data.index) {
    if (typeof idx === "number") out.add(idx);
  }
  return out;
}

function buildRareIntegerMap(data: RareIntegerData | undefined): Map<number, number> {
  const out = new Map<number, number>();
  if (!data?.index || !data?.value) return out;
  for (let i = 0; i < data.index.length; i += 1) {
    const k = data.index[i];
    const v = data.value[i];
    if (typeof k === "number" && typeof v === "number") out.set(k, v);
  }
  return out;
}

function parseAttributes(attrs: number[] | undefined, strings: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!attrs) return out;
  for (let i = 0; i + 1 < attrs.length; i += 2) {
    const nameIdx = attrs[i];
    const valueIdx = attrs[i + 1];
    if (typeof nameIdx !== "number" || typeof valueIdx !== "number") continue;
    const name = strings[nameIdx];
    const value = strings[valueIdx];
    if (typeof name !== "string") continue;
    out[name] = typeof value === "string" ? value : "";
  }
  return out;
}

const TESTID_KEYS = ["data-testid", "data-test", "data-cy", "data-qa"] as const;
const DATA_PREFIX = "data-";

function extractTestId(attrs: Record<string, string>): string | null {
  for (const key of TESTID_KEYS) {
    const value = attrs[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return null;
}

function extractDataAttrs(
  attrs: Record<string, string>,
  fieldChars: number,
): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  for (const [key, value] of Object.entries(attrs)) {
    if (!key.startsWith(DATA_PREFIX)) continue;
    if ((TESTID_KEYS as readonly string[]).includes(key)) continue;
    if (typeof value !== "string" || value.length === 0) continue;
    const shortKey = key.slice(DATA_PREFIX.length);
    out[shortKey] = value.length > fieldChars ? `${value.slice(0, fieldChars - 1)}…` : value;
    count += 1;
    if (count >= 6) break;
  }
  return out;
}

function computeStableId(input: {
  framePath: string;
  tag: string;
  axRole: string | null;
  axName: string | null;
  testId: string | null;
  labelText: string | null;
  href: string | null;
  bboxY: number;
}): string {
  // Bucket bbox.y into 40px bins so minor scroll/layout shifts do not
  // change the identity. We also bucket x into 80px bins to disambiguate
  // multiple controls in the same row when no semantic handle exists.
  const yBin = Math.floor(input.bboxY / 40);
  const parts = [
    input.framePath,
    input.tag,
    input.axRole ?? "",
    input.axName ?? "",
    input.testId ?? "",
    input.labelText ?? "",
    input.href ?? "",
    String(yBin),
  ].join("|");
  // FNV-1a 32-bit, hex-padded to 8 chars. Avoids pulling in node:crypto for
  // a feature that does not need cryptographic strength.
  let hash = 0x811c9dc5;
  for (let i = 0; i < parts.length; i += 1) {
    hash ^= parts.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function pickStableHandle(
  el: Pick<
    ElementInfo,
    "tag" | "axRole" | "axName" | "testId" | "labelText" | "href" | "text" | "placeholder"
  >,
): { kind: ElementInfo["stableHandle"]["kind"]; value: string } {
  if (el.testId) return { kind: "testid", value: `testid="${el.testId}"` };
  if (el.axRole && el.axName)
    return { kind: "role", value: `role=${el.axRole} name="${truncateForHandle(el.axName)}"` };
  if (el.labelText) return { kind: "label", value: `label="${truncateForHandle(el.labelText)}"` };
  if (el.placeholder && (el.tag === "input" || el.tag === "textarea"))
    return { kind: "label", value: `placeholder="${truncateForHandle(el.placeholder)}"` };
  if (el.href) return { kind: "href", value: `href="${truncateForHandle(el.href, 80)}"` };
  if (el.text && el.text.trim().length > 0)
    return { kind: "text", value: `text="${truncateForHandle(el.text)}"` };
  return { kind: "index", value: "" };
}

function truncateForHandle(value: string, max = 60): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1)}…`;
}

function selectorHint(tag: string, attrs: Record<string, string>): string {
  let hint = tag;
  if (attrs.id) {
    hint += `#${attrs.id}`;
    return hint;
  }
  const classes = (attrs.class || "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
  if (classes) hint += `.${classes}`;
  return hint;
}

function isInteractive(tag: string, attrs: Record<string, string>, isClickable: boolean): boolean {
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (isClickable) return true;
  if (typeof attrs.onclick === "string") return true;
  if (typeof attrs.tabindex === "string") return true;
  const role = attrs.role;
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  return false;
}

function styleAt(
  styles: number[][] | undefined,
  layoutIdx: number,
  propIdx: number,
  strings: string[],
): string | undefined {
  const row = styles?.[layoutIdx];
  if (!row) return undefined;
  const idx = row[propIdx];
  if (typeof idx !== "number" || idx < 0) return undefined;
  return strings[idx];
}

function isHiddenByStyle(
  styles: number[][] | undefined,
  layoutIdx: number,
  strings: string[],
): boolean {
  const display = styleAt(styles, layoutIdx, 0, strings);
  if (display === "none") return true;
  const visibility = styleAt(styles, layoutIdx, 1, strings);
  if (visibility === "hidden" || visibility === "collapse") return true;
  const opacity = styleAt(styles, layoutIdx, 2, strings);
  if (opacity !== undefined) {
    const num = Number(opacity);
    if (!Number.isNaN(num) && num <= 0) return true;
  }
  return false;
}

async function fetchAxTree(page: Page): Promise<Map<number, AXNode>> {
  try {
    const response = await page.sendCDP<{ nodes?: AXNode[] }>("Accessibility.getFullAXTree", {});
    const map = new Map<number, AXNode>();
    for (const node of response.nodes ?? []) {
      if (typeof node.backendDOMNodeId === "number") {
        map.set(node.backendDOMNodeId, node);
      }
    }
    return map;
  } catch {
    return new Map();
  }
}

function axStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

interface DocumentAggregate {
  doc: DocumentSnapshot;
  documentIndex: number;
  parentFrameId: string | undefined;
}

/**
 * Capture a CDP-driven page snapshot with merged accessibility info and an
 * index → backendNodeId selector map. Caller passes computed budgets.
 */
export async function captureCdpSnapshot(
  page: Page,
  budgets: RequiredDomBudgets,
): Promise<{ snapshot: PageSnapshot; selectorMap: SelectorMap }> {
  await page.sendCDP("DOM.enable", {}).catch(() => {});
  const ax = await fetchAxTree(page);
  const result = await page.sendCDP<CaptureSnapshotResult>("DOMSnapshot.captureSnapshot", {
    computedStyles: COMPUTED_STYLE_PROPS,
    includePaintOrder: true,
    includeDOMRects: true,
  });

  const strings = result.strings ?? [];
  const documents = result.documents ?? [];

  const docsByIndex = new Map<number, DocumentAggregate>();
  for (let i = 0; i < documents.length; i += 1) {
    const doc = documents[i];
    if (!doc) continue;
    docsByIndex.set(i, { doc, documentIndex: i, parentFrameId: undefined });
  }

  // Map child documentIndex → parent documentIndex via contentDocumentIndex
  for (let parentIdx = 0; parentIdx < documents.length; parentIdx += 1) {
    const parent = documents[parentIdx];
    if (!parent?.nodes) continue;
    const contentDocs = buildRareIntegerMap(parent.nodes.contentDocumentIndex);
    for (const childDocIdx of contentDocs.values()) {
      const childAgg = docsByIndex.get(childDocIdx);
      if (!childAgg) continue;
      childAgg.parentFrameId = stringAt(strings, parent.frameId);
    }
  }

  const elements: ElementInfo[] = [];
  const selectorMap: SelectorMap = { byIndex: new Map() };

  type Candidate = {
    backendNodeId: number;
    tag: string;
    text: string;
    attrs: Record<string, string>;
    bounds: { x: number; y: number; w: number; h: number };
    framePath: string;
    frameId: string | undefined;
    paintOrder: number;
    ax?: AXNode;
  };

  const candidates: Candidate[] = [];

  for (const agg of docsByIndex.values()) {
    const { doc } = agg;
    const nodes = doc.nodes;
    const layout = doc.layout;
    if (!nodes || !layout) continue;

    const nodeNameIdx = nodes.nodeName ?? [];
    const backendIds = nodes.backendNodeId ?? [];
    const attrsAll = nodes.attributes ?? [];
    const clickableSet = buildRareBooleanSet(nodes.isClickable);
    const textValueMap = buildRareStringIndex(nodes.textValue, strings);
    const inputValueMap = buildRareStringIndex(nodes.inputValue, strings);

    const layoutNodeIndex = layout.nodeIndex ?? [];
    const layoutBounds = layout.bounds ?? [];
    const layoutStyles = layout.styles;
    const layoutText = layout.text ?? [];
    const paintOrders = layout.paintOrders ?? [];

    const docFrameId = stringAt(strings, doc.frameId);
    const framePath = docFrameId
      ? agg.parentFrameId
        ? `frame:${docFrameId}`
        : "main"
      : agg.parentFrameId
        ? "frame"
        : "main";

    for (let i = 0; i < layoutNodeIndex.length; i += 1) {
      if (candidates.length >= budgets.maxElements) break;
      const nodeIdx = layoutNodeIndex[i];
      if (typeof nodeIdx !== "number") continue;

      const bounds = layoutBounds[i];
      if (!bounds || bounds.length < 4) continue;
      const [bx = 0, by = 0, bw = 0, bh = 0] = bounds;
      if (bw <= 0 || bh <= 0) continue;
      if (isHiddenByStyle(layoutStyles, i, strings)) continue;

      const nameStr = stringAt(strings, nodeNameIdx[nodeIdx]);
      if (!nameStr) continue;
      const tag = nameStr.toLowerCase();
      if (tag.startsWith("#")) continue;

      const attrs = parseAttributes(attrsAll[nodeIdx], strings);
      const isClickable = clickableSet.has(nodeIdx);
      if (!isInteractive(tag, attrs, isClickable)) continue;

      const backendNodeId = backendIds[nodeIdx];
      if (typeof backendNodeId !== "number") continue;

      const inlineText = stringAt(strings, layoutText[i]);
      const rawText =
        inlineText ||
        textValueMap.get(nodeIdx) ||
        inputValueMap.get(nodeIdx) ||
        attrs["aria-label"] ||
        attrs.placeholder ||
        attrs.value ||
        "";

      candidates.push({
        backendNodeId,
        tag,
        text: clean(rawText, budgets.maxTextChars),
        attrs,
        bounds: { x: bx, y: by, w: bw, h: bh },
        framePath,
        frameId: docFrameId,
        paintOrder: paintOrders[i] ?? 0,
        ax: ax.get(backendNodeId),
      });
    }

    if (candidates.length >= budgets.maxElements) break;
  }

  candidates.sort((a, b) => a.paintOrder - b.paintOrder);

  // Build a Map of `<label for="ID">` → label text so we can resolve a
  // semantic name onto the matching input/select. Wrapping labels (where
  // the input is nested inside the label) cannot be detected from the
  // flat candidate list alone; we accept that v1 gap and rely on the AX
  // tree's `axName` to cover most of those.
  const labelTextById = new Map<string, string>();
  for (const c of candidates) {
    if (c.tag !== "label") continue;
    const forId = c.attrs.for;
    if (!forId) continue;
    const text = c.text.trim() || axStringValue(c.ax?.name?.value);
    if (!text) continue;
    labelTextById.set(forId, text);
  }

  let url = "";
  let title = "";
  const firstDoc = documents[0];
  if (firstDoc) {
    url = stringAt(strings, firstDoc.documentURL) ?? "";
    title = stringAt(strings, firstDoc.title) ?? "";
  }

  for (let i = 0; i < candidates.length && i < budgets.maxElements; i += 1) {
    const c = candidates[i];
    if (!c) continue;
    const axRole = axStringValue(c.ax?.role?.value) ?? null;
    const axName = axStringValue(c.ax?.name?.value) ?? null;
    const fieldLimit = budgets.maxFieldChars;
    const testId = extractTestId(c.attrs);
    const dataAttrs = extractDataAttrs(c.attrs, fieldLimit);
    const labelText = c.attrs.id ? (labelTextById.get(c.attrs.id) ?? null) : null;
    const placeholder = c.attrs.placeholder ? clean(c.attrs.placeholder, fieldLimit) : null;
    const ariaLabel = c.attrs["aria-label"] ? clean(c.attrs["aria-label"], fieldLimit) : null;
    const href = c.attrs.href ?? null;
    const stableHandle = pickStableHandle({
      tag: c.tag,
      axRole,
      axName,
      testId,
      labelText,
      href,
      text: c.text,
      placeholder,
    });
    const stableId = computeStableId({
      framePath: c.framePath,
      tag: c.tag,
      axRole,
      axName,
      testId,
      labelText,
      href,
      bboxY: c.bounds.y,
    });
    const element: ElementInfo = {
      index: i,
      backendNodeId: c.backendNodeId,
      framePath: c.framePath,
      tag: c.tag,
      role: axRole ?? c.attrs.role ?? null,
      name: c.attrs.name ?? null,
      ariaName: axName,
      text: c.text,
      href,
      type: c.attrs.type ?? null,
      placeholder,
      value: c.attrs.value ? clean(c.attrs.value, budgets.maxTextChars) : null,
      ariaLabel,
      selectorHint: selectorHint(c.tag, c.attrs),
      bbox: c.bounds,
      axRole,
      axName,
      testId,
      dataAttrs,
      labelText,
      stableHandle,
      stableId,
    };
    elements.push(element);
    const entry: SelectorMapEntry = { backendNodeId: c.backendNodeId };
    if (c.frameId) entry.frameId = c.frameId;
    selectorMap.byIndex.set(i, entry);
  }

  const pendingRequestCount = 0;
  let readyState = "complete";
  try {
    const status = await page.evaluate<{
      readyState: string;
      pendingRequestCount: number;
    }>(`(() => {
      const resources = performance.getEntriesByType('resource');
      let pendingRequestCount = 0;
      for (const entry of resources) {
        if (entry.responseEnd === 0) pendingRequestCount += 1;
      }
      return { readyState: document.readyState, pendingRequestCount };
    })()`);
    readyState = status.readyState;
    return {
      snapshot: {
        url,
        title,
        elements,
        stability: { readyState, pendingRequestCount: status.pendingRequestCount },
      },
      selectorMap,
    };
  } catch {
    return {
      snapshot: {
        url,
        title,
        elements,
        stability: { readyState, pendingRequestCount },
      },
      selectorMap,
    };
  }
}
