import {
  captureBrowserState,
  type BrowserStateOptions,
  type BrowserStateSummary,
} from "../browser/state";
import type { BrowserSession, Page } from "../browser/session";

export interface ObservePageOptions extends BrowserStateOptions {}

export async function observePage(
  page: Page,
  session?: BrowserSession,
  options: ObservePageOptions = {},
): Promise<BrowserStateSummary> {
  return captureBrowserState(page, session, options);
}

export interface RefreshPageStateOptions extends ObservePageOptions {
  previousUrl?: string;
  maxAttempts?: number;
  retryDelayMs?: number;
}

export async function refreshPageState(
  page: Page,
  session?: BrowserSession,
  options: RefreshPageStateOptions = {},
): Promise<BrowserStateSummary> {
  const maxAttempts = options.maxAttempts ?? 8;
  const retryDelayMs = options.retryDelayMs ?? 500;
  const {
    previousUrl,
    maxAttempts: _maxAttempts,
    retryDelayMs: _retryDelayMs,
    ...observeOptions
  } = options;

  let state = await observePage(page, session, observeOptions);
  let previousState = state;
  let waitedAfterUrlChange = false;

  for (
    let attempt = 0;
    shouldRetryState(state, previousState, previousUrl, waitedAfterUrlChange) &&
    attempt < maxAttempts;
    attempt += 1
  ) {
    await page.waitForTimeout(retryDelayMs);
    if (previousUrl && state.url !== previousUrl) waitedAfterUrlChange = true;
    previousState = state;
    state = await observePage(page, session, observeOptions);
  }

  return state;
}

function shouldRetryState(
  state: BrowserStateSummary,
  previousState: BrowserStateSummary,
  previousUrl: string | undefined,
  waitedAfterUrlChange: boolean,
): boolean {
  if (state.elements.length === 0) {
    return state.readyState === "loading" || state.title.length === 0;
  }
  if (state.readyState === "loading") return true;
  if (!previousUrl || state.url === previousUrl) return false;
  if (!waitedAfterUrlChange) return true;
  return state.url !== previousState.url;
}
