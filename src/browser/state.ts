import { formatSnapshotForLLM, serializePage } from "../dom/serialize";
import type { ElementInfo, PageSnapshot } from "../dom/types";
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
  observation: string;
  screenshot?: ScreenshotState;
}

export interface BrowserStateOptions {
  includeScreenshot?: boolean;
  screenshotDetail?: "auto" | "low" | "high";
}

export async function captureBrowserState(
  page: Page,
  session?: BrowserSession,
  options: BrowserStateOptions = {},
): Promise<BrowserStateSummary> {
  await page.waitForStablePage(3_000).catch(() => {
    // A usable state is better than failing the whole step because the page is busy.
  });

  const snapshot = await serializePage(page);
  const pendingRequests = await page.getPendingNetworkRequests(5).catch(() => []);
  const viewport = await readViewport(page);
  const tabs = await readTabs(page, session);
  const screenshot = options.includeScreenshot
    ? await captureScreenshotState(page, viewport, options.screenshotDetail ?? "auto").catch(
        () => undefined,
      )
    : undefined;

  const observation = buildObservation(snapshot, pendingRequests, screenshot);

  return {
    url: snapshot.url,
    title: snapshot.title,
    activeTab: page.targetId,
    tabs,
    viewport,
    readyState: snapshot.stability.readyState,
    pendingRequests,
    elements: snapshot.elements,
    observation,
    ...(screenshot ? { screenshot } : {}),
  };
}

function buildObservation(
  snapshot: PageSnapshot,
  pendingRequests: PendingNetworkRequest[],
  screenshot?: ScreenshotState,
): string {
  const pendingSummary =
    pendingRequests.length === 0
      ? "PENDING REQUESTS: none"
      : `PENDING REQUESTS (${pendingRequests.length}):\n${pendingRequests
          .map((req) => `- ${req.method} ${req.resourceType} ${req.loadingDurationMs}ms ${req.url}`)
          .join("\n")}`;
  const screenshotSummary = screenshot
    ? `SCREENSHOT: image/png ${screenshot.width}x${screenshot.height} detail=${screenshot.detail}`
    : "SCREENSHOT: not captured";

  return `${formatSnapshotForLLM(snapshot)}\n${pendingSummary}\n${screenshotSummary}`;
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
