import type { BrowserSession, Page } from "../browser/session";
import { captureBrowserState, type BrowserStateSummary } from "../browser/state";
import type { DomBudgetOptions } from "../dom/cdp-snapshot";

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
): Promise<StepContext> {
  const browserState = await captureBrowserState(page, session, {
    includeScreenshot: vision !== false,
    screenshotDetail: "auto",
    domBudgets,
  });
  const tabs = browserState.tabs.map((tab) => tab.targetId);
  return { browserState, observation: browserState.observation, tabs };
}
