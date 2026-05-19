import type { DomBudgetOptions, SelectorMap } from "../dom/cdp-snapshot";
import { formatSnapshotDiff, formatSnapshotForLLM, serializePage } from "../dom/serialize";
import type { ElementBBox, ElementInfo, PageSnapshot } from "../dom/types";
import type { BrowserSession, Page, PendingNetworkRequest } from "./session";

export interface ScreenshotState {
  base64: string;
  mediaType: "image/png";
  width: number;
  height: number;
  capturedAt: string;
  detail: "auto" | "low" | "high";
}

export interface TabState {
  targetId: string;
  active: boolean;
}

export interface BrowserStateSummary {
  url: string;
  title: string;
  activeTab: string;
  tabs: TabState[];
  viewport: { width: number; height: number };
  readyState: string;
  pendingRequests: PendingNetworkRequest[];
  elements: ElementInfo[];
  selectorMap: SelectorMap;
  observation: string;
  /** Raw snapshot used to build `observation`. Useful for diffing on the next step. */
  snapshot: PageSnapshot;
  /** True when `observation` was rendered as a diff against `prevSnapshot`. */
  observationIsDiff: boolean;
  screenshot?: ScreenshotState;
}

export interface BrowserStateOptions {
  includeScreenshot?: boolean;
  screenshotDetail?: "auto" | "low" | "high";
  domBudgets?: DomBudgetOptions;
  /** When set, the LLM observation only lists elements that overlap this bbox. */
  focusBbox?: ElementBBox;
  /** Human-readable label printed above the focused observation. */
  focusReason?: string;
  /** Previous snapshot — when provided, render the observation as a diff. */
  prevSnapshot?: PageSnapshot | null;
}

export async function captureBrowserState(
  page: Page,
  session?: BrowserSession,
  options: BrowserStateOptions = {},
): Promise<BrowserStateSummary> {
  await page.waitForStablePage(3_000).catch(() => {
    // A usable state is better than failing the whole step because the page is busy.
  });

  const { snapshot, selectorMap } = await serializePage(page, options.domBudgets);
  const pendingRequests = await page.getPendingNetworkRequests(5).catch(() => []);
  const viewport = await readViewport(page);
  const tabs = await readTabs(page, session);
  const screenshot = options.includeScreenshot
    ? await captureScreenshotState(page, viewport, options.screenshotDetail ?? "auto").catch(
        () => undefined,
      )
    : undefined;

  const { text: observation, usedDiff } = buildObservation(
    snapshot,
    pendingRequests,
    screenshot,
    options.domBudgets,
    options.focusBbox,
    options.focusReason,
    options.prevSnapshot ?? null,
  );

  return {
    url: snapshot.url,
    title: snapshot.title,
    activeTab: page.targetId,
    tabs,
    viewport,
    readyState: snapshot.stability.readyState,
    pendingRequests,
    elements: snapshot.elements,
    selectorMap,
    observation,
    snapshot,
    observationIsDiff: usedDiff,
    ...(screenshot ? { screenshot } : {}),
  };
}

function bboxOverlaps(a: ElementBBox, b: ElementBBox): boolean {
  if (a.w <= 0 || a.h <= 0) return false;
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}

function buildObservation(
  snapshot: PageSnapshot,
  pendingRequests: PendingNetworkRequest[],
  screenshot: ScreenshotState | undefined,
  budgets: DomBudgetOptions | undefined,
  focusBbox: ElementBBox | undefined,
  focusReason: string | undefined,
  prevSnapshot: PageSnapshot | null,
): { text: string; usedDiff: boolean } {
  const pendingSummary =
    pendingRequests.length === 0
      ? "PENDING REQUESTS: none"
      : `PENDING REQUESTS (${pendingRequests.length}):\n${pendingRequests
          .map((req) => `- ${req.method} ${req.resourceType} ${req.loadingDurationMs}ms ${req.url}`)
          .join("\n")}`;
  const screenshotSummary = screenshot
    ? `SCREENSHOT: image/png ${screenshot.width}x${screenshot.height} detail=${screenshot.detail}`
    : "SCREENSHOT: not captured";

  let body: string;
  let usedDiff = false;
  if (focusBbox) {
    const fullCount = snapshot.elements.length;
    const focused: PageSnapshot = {
      ...snapshot,
      elements: snapshot.elements.filter((el) => bboxOverlaps(el.bbox, focusBbox)),
    };
    const header =
      `FOCUS ACTIVE${focusReason ? `: ${focusReason}` : ""}` +
      ` — bbox(${Math.round(focusBbox.x)},${Math.round(focusBbox.y)},${Math.round(focusBbox.w)}×${Math.round(focusBbox.h)}); ` +
      `showing ${focused.elements.length}/${fullCount} elements that overlap focus. ` +
      `Call focus_area(clear=true) to see the whole page again.`;
    body = `${header}\n${formatSnapshotForLLM(focused, budgets)}`;
  } else if (prevSnapshot) {
    const diffed = formatSnapshotDiff(prevSnapshot, snapshot, budgets);
    body = diffed.text;
    usedDiff = diffed.usedDiff;
  } else {
    body = formatSnapshotForLLM(snapshot, budgets);
  }

  return { text: `${body}\n${pendingSummary}\n${screenshotSummary}`, usedDiff };
}

async function readViewport(page: Page): Promise<{ width: number; height: number }> {
  return page
    .evaluate<{ width: number; height: number }>(`(() => ({
      width: window.innerWidth || document.documentElement.clientWidth || 0,
      height: window.innerHeight || document.documentElement.clientHeight || 0,
    }))()`)
    .catch(() => ({ width: 0, height: 0 }));
}

async function readTabs(page: Page, session?: BrowserSession): Promise<TabState[]> {
  const targetIds = session
    ? await session.listPageTargetIds().catch(() => [page.targetId])
    : [page.targetId];
  return targetIds.map((targetId) => ({ targetId, active: targetId === page.targetId }));
}

async function captureScreenshotState(
  page: Page,
  viewport: { width: number; height: number },
  detail: "auto" | "low" | "high",
): Promise<ScreenshotState> {
  const base64 = await page.screenshot();
  return {
    base64,
    mediaType: "image/png",
    width: viewport.width,
    height: viewport.height,
    capturedAt: new Date().toISOString(),
    detail,
  };
}
