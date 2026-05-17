import type { BrowserSession, Page } from "../browser/session";
import { captureBrowserState, type BrowserStateSummary } from "../browser/state";
import type { DomBudgetOptions } from "../dom/cdp-snapshot";
import type { FocusState } from "./focus-state";

export interface StepContext {
  browserState: BrowserStateSummary;
  observation: string;
  tabs: string[];
}

export async function buildStepContext(
  page: Page,
  session: BrowserSession | undefined,
  vision: boolean | "auto",
  domBudgets: DomBudgetOptions | undefined,
  focusState?: FocusState,
): Promise<StepContext> {
  const focus = focusState?.get() ?? null;
  const browserState = await captureBrowserState(page, session, {
    includeScreenshot: vision !== false,
    screenshotDetail: "auto",
    domBudgets,
    ...(focus ? { focusBbox: focus.bbox, focusReason: focus.reason } : {}),
  });
  // Drop stale focus once we observe a different URL (e.g. after navigation).
  focusState?.clearIfStale(browserState.url);
  const tabs = browserState.tabs.map((tab) => tab.targetId);
  return { browserState, observation: browserState.observation, tabs };
}
