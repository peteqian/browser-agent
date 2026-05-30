import type { BrowserStateSummary } from "../browser/state";
import type { DomBudgetOptions } from "../dom/cdp-snapshot";
import type { PageSnapshot } from "../dom/types";
import type { SessionRunner } from "../runtime/session-runner";
import type { FocusState } from "./focus-state";

export interface StepContext {
  browserState: BrowserStateSummary;
  observation: string;
  tabs: string[];
}

export async function buildStepContext(
  runner: SessionRunner,
  vision: boolean | "auto",
  domBudgets: DomBudgetOptions | undefined,
  focusState?: FocusState,
  prevSnapshot?: PageSnapshot | null,
): Promise<StepContext> {
  const focus = focusState?.get() ?? null;
  const browserState = await runner.observe({
    includeScreenshot: vision === true,
    screenshotDetail: "auto",
    domBudgets,
    ...(focus ? { focusBbox: focus.bbox, focusReason: focus.reason } : {}),
    ...(prevSnapshot ? { prevSnapshot } : {}),
  });
  // Drop stale focus once we observe a different URL (e.g. after navigation).
  focusState?.clearIfStale(browserState.url);
  const tabs = browserState.tabs.map((tab) => tab.targetId);
  return { browserState, observation: browserState.observation, tabs };
}
