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
  /**
   * Set when the element lives in an out-of-process iframe (cross-origin
   * embed). Actions must execute against this target's session, not the
   * main page's — `backendNodeId` is only meaningful there.
   */
  targetId?: string;
}

export interface SelectorMap {
  byIndex: Map<number, SelectorMapEntry>;
}

export type RequiredDomBudgets = Required<DomBudgetOptions>;

export const DEFAULT_DOM_BUDGETS: RequiredDomBudgets = {
  maxElements: 1200,
  maxDisplayElements: 100,
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
    "data-automation-id",
  ],
  maxTotalChars: 12_000,
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
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "tab",
  "option",
  "slider",
  "spinbutton",
  "switch",
  "textbox",
  "combobox",
  "searchbox",
  "treeitem",
  "iframe",
]);

const CONTENT_ROLES = new Set([
  "heading",
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  "listitem",
  "article",
  "region",
  "main",
  "navigation",
  "search",
  "form",
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

const TESTID_KEYS = [
  "data-testid",
  "data-test",
  "data-cy",
  "data-qa",
  // Workday renders its entire application flow with these.
  "data-automation-id",
] as const;
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

function isObservableCandidate(input: {
  tag: string;
  attrs: Record<string, string>;
  isClickable: boolean;
  axRole: string | null;
  axName: string | null;
}): boolean {
  const { tag, attrs, isClickable, axRole, axName } = input;
  if (INTERACTIVE_TAGS.has(tag)) return true;
  if (isClickable) return true;
  if (typeof attrs.onclick === "string") return true;
  if (typeof attrs.tabindex === "string") return true;
  const role = (axRole ?? attrs.role ?? "").toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (role && CONTENT_ROLES.has(role) && axName) return true;
  return false;
}

function candidateRank(candidate: {
  tag: string;
  text: string;
  attrs: Record<string, string>;
  ax?: AXNode;
}): number {
  const role = usefulAxRole(axStringValue(candidate.ax?.role?.value)) ?? candidate.attrs.role ?? "";
  const name = axStringValue(candidate.ax?.name?.value) ?? "";
  const type = (candidate.attrs.type ?? "").toLowerCase();
  const visibleLabel = [candidate.text, name, candidate.attrs["aria-label"] ?? ""].join(" ");
  const hasName =
    candidate.text.trim().length > 0 ||
    name.length > 0 ||
    Boolean(candidate.attrs["aria-label"]) ||
    Boolean(candidate.attrs.placeholder) ||
    Boolean(candidate.attrs.name);

  if (isDateChoiceLabel(visibleLabel)) return 1;
  if (candidate.tag === "input" && (type === "checkbox" || type === "radio")) {
    return hasName ? 3 : 8;
  }
  if (candidate.tag === "input" || candidate.tag === "textarea" || candidate.tag === "select") {
    return 0;
  }
  if (candidate.tag === "button" || role === "button") return hasName ? 1 : 6;
  if (role === "combobox" || role === "textbox" || role === "searchbox") return 1;
  if (candidate.tag === "a" || role === "link") return hasName ? 4 : 7;
  if (role && role !== "generic") return hasName ? 5 : 8;
  return hasName ? 5 : 9;
}

function isDateChoiceLabel(label: string): boolean {
  return (
    /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)?[,]?\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4}\b/i.test(
      label,
    ) ||
    /\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i.test(
      label,
    )
  );
}

function isLowSignalElement(
  tag: string,
  axRole: string | null,
  axName: string | null,
  text: string,
  placeholder: string | null,
  ariaLabel: string | null,
  href: string | null,
  testId: string | null,
): boolean {
  if (tag === "input" || tag === "textarea" || tag === "select") return false;
  if (tag === "button" || tag === "a") {
    return !axName && !text.trim() && !placeholder && !ariaLabel && !href && !testId;
  }
  if (axRole && axRole !== "generic") return false;
  return !axName && !text.trim() && !placeholder && !ariaLabel && !href && !testId;
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

interface AxTree {
  nodes: AXNode[];
  byBackendNodeId: Map<number, AXNode>;
}

function axNodeScore(node: AXNode): number {
  if (node.ignored === true) return 0;
  const role = usefulAxRole(axStringValue(node.role?.value));
  const name = axStringValue(node.name?.value);
  if (!role) return 1;
  if (INTERACTIVE_ROLES.has(role.toLowerCase())) return name ? 5 : 4;
  if (CONTENT_ROLES.has(role.toLowerCase())) return name ? 4 : 2;
  return name ? 3 : 2;
}

async function fetchAxTree(page: Page): Promise<AxTree> {
  try {
    const response = await page.sendCDP<{ nodes?: AXNode[] }>("Accessibility.getFullAXTree", {});
    const map = new Map<number, AXNode>();
    const nodes = response.nodes ?? [];
    for (const node of nodes) {
      if (typeof node.backendDOMNodeId === "number") {
        const prev = map.get(node.backendDOMNodeId);
        if (!prev || axNodeScore(node) > axNodeScore(prev)) {
          map.set(node.backendDOMNodeId, node);
        }
      }
    }
    return { nodes, byBackendNodeId: map };
  } catch {
    return { nodes: [], byBackendNodeId: new Map() };
  }
}

interface LiveElementLabel {
  text: string;
  value: string;
  ariaLabel: string;
  placeholder: string;
}

async function readLiveElementLabel(
  page: Page,
  backendNodeId: number,
): Promise<LiveElementLabel | null> {
  if (typeof page.callOnBackendNode !== "function") return null;
  const result = await page.callOnBackendNode<LiveElementLabel>(
    backendNodeId,
    `function() {
      const text = (this.innerText || this.textContent || "").replace(/\\s+/g, " ").trim();
      const value = typeof this.value === "string" ? this.value.trim() : "";
      return {
        text,
        value,
        ariaLabel: this.getAttribute("aria-label") || "",
        placeholder: this.getAttribute("placeholder") || "",
      };
    }`,
  );
  return result.ok ? result.value : null;
}

function shouldReadLiveLabel(candidate: {
  tag: string;
  text: string;
  attrs: Record<string, string>;
}): boolean {
  if (candidate.tag === "button") return true;
  if (candidate.tag === "input" || candidate.tag === "textarea" || candidate.tag === "select") {
    return !candidate.text && !candidate.attrs.value && !candidate.attrs.placeholder;
  }
  return false;
}

function axStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function usefulAxRole(value: string | undefined): string | null {
  if (!value || value === "none" || value === "generic") return null;
  return value;
}

async function readActionableHitTest(
  page: Page,
  backendNodeIds: readonly number[],
): Promise<Map<number, boolean>> {
  if (backendNodeIds.length === 0) return new Map();
  if (typeof page.callOnBackendNode !== "function") return new Map();
  const map = new Map<number, boolean>();
  for (const backendNodeId of Array.from(new Set(backendNodeIds))) {
    const result = await page
      .callOnBackendNode<boolean>(
        backendNodeId,
        `function() {
          const r = this.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) return false;
          const x = Math.min(Math.max(r.left + r.width / 2, 0), window.innerWidth - 1);
          const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
          const hit = document.elementFromPoint(x, y);
          return !!hit && (hit === this || this.contains(hit) || hit.contains(this));
        }`,
      )
      .catch(() => null);
    map.set(backendNodeId, result?.ok ? result.value : true);
  }
  return map;
}

interface AxDomInfo {
  tag: string;
  text: string;
  attrs: Record<string, string>;
  bounds: { x: number; y: number; w: number; h: number };
}

async function readAxDomInfo(page: Page, backendNodeId: number): Promise<AxDomInfo | null> {
  if (typeof page.callOnBackendNode !== "function") return null;
  const result = await page
    .callOnBackendNode<AxDomInfo | null>(
      backendNodeId,
      `function() {
        if (!(this instanceof Element)) return null;
        const rect = this.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return null;
        const style = window.getComputedStyle(this);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          style.visibility === "collapse" ||
          Number(style.opacity || "1") <= 0
        ) {
          return null;
        }
        const attrs = {};
        for (const attr of this.attributes) attrs[attr.name] = attr.value;
        return {
          tag: this.tagName.toLowerCase(),
          text: (this.innerText || this.textContent || "").replace(/\\s+/g, " ").trim(),
          attrs,
          bounds: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
        };
      }`,
    )
    .catch(() => null);
  return result?.ok ? result.value : null;
}

interface DocumentAggregate {
  doc: DocumentSnapshot;
  documentIndex: number;
  parentFrameId: string | undefined;
}

/** Out-of-process iframes expanded per snapshot. Keeps step latency bounded. */
const MAX_OOPIF_EXPANSIONS = 3;

interface IframeTargetInfo {
  targetId: string;
  type: string;
  url: string;
}

/** Minimal session surface the expansion needs — Page.session satisfies it. */
interface SessionLike {
  send<TResult>(method: string, params?: Record<string, unknown>): Promise<TResult>;
  getPage(targetId: string): Page;
}

function normalizeFrameUrl(url: string): string {
  return url.split("?")[0] ?? url;
}

/**
 * Cross-origin iframes (Greenhouse/Workday embeds and friends) live in
 * separate out-of-process targets that DOMSnapshot cannot pierce. Capture
 * each matching iframe target with the same pipeline, translate the element
 * bounds into main-page coordinates, and merge the results. Selector-map
 * entries carry the iframe `targetId` so actions execute on the right
 * session.
 */
async function expandCrossOriginIframes(
  page: Page,
  elements: ElementInfo[],
  selectorMap: SelectorMap,
  budgets: RequiredDomBudgets,
): Promise<void> {
  const flagged = elements.filter((el) => el.crossOriginIframe);
  if (flagged.length === 0) return;
  const session = (page as { session?: SessionLike }).session;
  if (!session || typeof session.send !== "function" || typeof session.getPage !== "function") {
    return;
  }

  const response = await session.send<{ targetInfos?: IframeTargetInfo[] }>("Target.getTargets");
  const iframeTargets = (response.targetInfos ?? []).filter((t) => t.type === "iframe");
  if (iframeTargets.length === 0) return;

  const usedTargets = new Set<string>();
  let expansions = 0;

  for (const iframeEl of flagged) {
    if (expansions >= MAX_OOPIF_EXPANSIONS) break;
    if (elements.length >= budgets.maxElements) break;

    const src = iframeEl.href ?? "";
    const available = iframeTargets.filter((t) => !usedTargets.has(t.targetId));
    const target =
      available.find((t) => t.url === src) ??
      available.find((t) => src && normalizeFrameUrl(t.url) === normalizeFrameUrl(src)) ??
      (flagged.length === 1 && available.length === 1 ? available[0] : undefined);
    if (!target) continue;
    usedTargets.add(target.targetId);
    expansions += 1;

    const childBudgets: RequiredDomBudgets = {
      ...budgets,
      maxElements: budgets.maxElements - elements.length,
    };
    let child: Awaited<ReturnType<typeof captureCdpSnapshot>>;
    try {
      child = await captureCdpSnapshot(session.getPage(target.targetId), childBudgets, {
        expandCrossOriginIframes: false,
      });
    } catch {
      continue;
    }
    if (child.snapshot.elements.length === 0) continue;

    for (const childEl of child.snapshot.elements) {
      if (elements.length >= budgets.maxElements) break;
      const index = elements.length;
      const childEntry = child.selectorMap.byIndex.get(childEl.index);
      elements.push({
        ...childEl,
        index,
        framePath: `oopif:${target.targetId}`,
        bbox: {
          x: childEl.bbox.x + iframeEl.bbox.x,
          y: childEl.bbox.y + iframeEl.bbox.y,
          w: childEl.bbox.w,
          h: childEl.bbox.h,
        },
      });
      selectorMap.byIndex.set(index, {
        backendNodeId: childEl.backendNodeId,
        targetId: target.targetId,
        ...(childEntry?.frameId ? { frameId: childEntry.frameId } : {}),
      });
    }

    // Content is now listed — drop the "content not listed" hint from the
    // iframe element itself.
    delete (iframeEl as { crossOriginIframe?: boolean }).crossOriginIframe;
  }
}

export interface CaptureSnapshotOptions {
  /**
   * Expand cross-origin iframes by capturing their out-of-process targets
   * and merging the elements into the snapshot (coordinates translated to
   * main-page space). Default: true. Disabled on the recursive child pass.
   */
  expandCrossOriginIframes?: boolean;
}

/**
 * Capture a CDP-driven page snapshot with merged accessibility info and an
 * index → backendNodeId selector map. Caller passes computed budgets.
 */
export async function captureCdpSnapshot(
  page: Page,
  budgets: RequiredDomBudgets,
  options: CaptureSnapshotOptions = {},
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
    crossOriginIframe: boolean;
  };

  const candidates: Candidate[] = [];
  const candidateBackendIds = new Set<number>();

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
    // Iframes with a captured child document are same-process; the rest are
    // cross-origin/OOPIF — their content is invisible to this snapshot.
    const capturedContentDocs = buildRareIntegerMap(nodes.contentDocumentIndex);

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
      const backendNodeId = backendIds[nodeIdx];
      if (typeof backendNodeId !== "number") continue;
      const axNode = ax.byBackendNodeId.get(backendNodeId);
      // An AX-ignored node (e.g. aria-hidden) must not be promoted on the
      // strength of its role/name — the second AX loop skips ignored nodes
      // outright, so keep the two paths consistent. DOM/clickable signals may
      // still make it observable.
      const axIgnored = axNode?.ignored === true;
      const axRole = axIgnored ? null : usefulAxRole(axStringValue(axNode?.role?.value));
      const axName = axIgnored ? null : (axStringValue(axNode?.name?.value) ?? null);
      const crossOriginIframe = tag === "iframe" && !capturedContentDocs.has(nodeIdx);
      if (
        !crossOriginIframe &&
        !isObservableCandidate({ tag, attrs, isClickable, axRole, axName })
      ) {
        continue;
      }

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
        ax: axNode,
        crossOriginIframe,
      });
      candidateBackendIds.add(backendNodeId);
    }

    if (candidates.length >= budgets.maxElements) break;
  }

  // Collect AX nodes the DOM-snapshot pass missed, then read their DOM info in
  // parallel — one awaited CDP round-trip per node in series scaled per-step
  // latency with the AX tree size and tripped stepTimeoutMs on busy pages.
  const remaining = budgets.maxElements - candidates.length;
  if (remaining > 0) {
    const eligible: Array<{ axNode: (typeof ax.nodes)[number]; backendNodeId: number }> = [];
    for (const axNode of ax.nodes) {
      if (eligible.length >= remaining) break;
      const backendNodeId = axNode.backendDOMNodeId;
      if (typeof backendNodeId !== "number") continue;
      if (candidateBackendIds.has(backendNodeId)) continue;
      if (axNode.ignored === true) continue;

      const axRole = usefulAxRole(axStringValue(axNode.role?.value));
      const axName = axStringValue(axNode.name?.value) ?? null;
      if (!isObservableCandidate({ tag: "", attrs: {}, isClickable: false, axRole, axName })) {
        continue;
      }

      candidateBackendIds.add(backendNodeId);
      eligible.push({ axNode, backendNodeId });
    }

    const domInfos = await Promise.all(
      eligible.map((entry) => readAxDomInfo(page, entry.backendNodeId)),
    );

    for (let i = 0; i < eligible.length; i += 1) {
      const domInfo = domInfos[i];
      if (!domInfo) continue;
      const entry = eligible[i] as (typeof eligible)[number];

      candidates.push({
        backendNodeId: entry.backendNodeId,
        tag: domInfo.tag,
        text: clean(domInfo.text, budgets.maxTextChars),
        attrs: domInfo.attrs,
        bounds: domInfo.bounds,
        framePath: "main",
        frameId: undefined,
        paintOrder: candidates.length,
        ax: entry.axNode,
        crossOriginIframe: false,
      });
    }
  }

  candidates.sort(
    (a, b) =>
      a.bounds.y - b.bounds.y ||
      a.bounds.x - b.bounds.x ||
      candidateRank(a) - candidateRank(b) ||
      a.paintOrder - b.paintOrder,
  );

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

  const hitTestLimit = Math.min(candidates.length, budgets.maxDisplayElements * 3, 300);
  const actionableByBackendId = await readActionableHitTest(
    page,
    candidates.slice(0, hitTestLimit).map((candidate) => candidate.backendNodeId),
  );

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
    const axRole = usefulAxRole(axStringValue(c.ax?.role?.value));
    const axNameForHitTest = axStringValue(c.ax?.name?.value);
    const semanticAxNode =
      axRole &&
      axNameForHitTest &&
      (INTERACTIVE_ROLES.has(axRole.toLowerCase()) || CONTENT_ROLES.has(axRole.toLowerCase()));
    if (
      actionableByBackendId.get(c.backendNodeId) === false &&
      !semanticAxNode &&
      !c.crossOriginIframe
    ) {
      continue;
    }
    const live = shouldReadLiveLabel(c) ? await readLiveElementLabel(page, c.backendNodeId) : null;
    const liveText = live?.text ? clean(live.text, budgets.maxTextChars) : "";
    const liveValue = live?.value ? clean(live.value, budgets.maxTextChars) : "";
    const axName = axStringValue(c.ax?.name?.value) ?? (liveText || liveValue || null);
    const fieldLimit = budgets.maxFieldChars;
    const testId = extractTestId(c.attrs);
    const dataAttrs = extractDataAttrs(c.attrs, fieldLimit);
    const labelText = c.attrs.id ? (labelTextById.get(c.attrs.id) ?? null) : null;
    const placeholder = c.attrs.placeholder
      ? clean(c.attrs.placeholder, fieldLimit)
      : live?.placeholder
        ? clean(live.placeholder, fieldLimit)
        : null;
    const ariaLabel = c.attrs["aria-label"]
      ? clean(c.attrs["aria-label"], fieldLimit)
      : live?.ariaLabel
        ? clean(live.ariaLabel, fieldLimit)
        : null;
    // For cross-origin iframes, expose the frame src so the agent can
    // navigate straight into the embedded document (job-board forms etc.).
    const href = c.attrs.href ?? (c.crossOriginIframe ? (c.attrs.src ?? null) : null);
    const text = liveText || c.text;
    const value = liveValue || (c.attrs.value ? clean(c.attrs.value, budgets.maxTextChars) : null);
    const stableHandle = pickStableHandle({
      tag: c.tag,
      axRole,
      axName,
      testId,
      labelText,
      href,
      text,
      placeholder,
    });
    if (
      !c.crossOriginIframe &&
      isLowSignalElement(c.tag, axRole, axName, text, placeholder, ariaLabel, href, testId)
    ) {
      continue;
    }
    const index = elements.length;
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
      index,
      backendNodeId: c.backendNodeId,
      framePath: c.framePath,
      tag: c.tag,
      role: axRole ?? c.attrs.role ?? null,
      name: c.attrs.name ?? null,
      ariaName: axName,
      text,
      href,
      type: c.attrs.type ?? null,
      placeholder,
      value,
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
      ...(c.crossOriginIframe ? { crossOriginIframe: true } : {}),
    };
    elements.push(element);
    const entry: SelectorMapEntry = { backendNodeId: c.backendNodeId };
    if (c.frameId) entry.frameId = c.frameId;
    selectorMap.byIndex.set(element.index, entry);
  }

  if (options.expandCrossOriginIframes !== false) {
    await expandCrossOriginIframes(page, elements, selectorMap, budgets).catch(() => {
      // Expansion is best-effort: the iframe element keeps its
      // crossOriginIframe flag and the serialized hint when it fails.
    });
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
