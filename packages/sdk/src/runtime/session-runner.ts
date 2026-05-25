import {
  createDefaultActionRegistry,
  type ActionRegistry,
  type RegisteredAction,
} from "../actions/registry";
import type { ActionResult } from "../actions/handlers/shared";
import type { Action } from "../actions/types";
import type { BrowserSession, Page } from "../browser/session";
import type { BrowserStateSummary } from "../browser/state";
import type { DomBudgetOptions } from "../dom/cdp-snapshot";
import type { ExtractionLLMFn } from "../agent/contracts";
import type { FocusState } from "../agent/focus-state";
import {
  executeRuntimeAction,
  runRuntimeActions,
  shouldReobserve,
  type RuntimeAction,
} from "./executor";
import { observePage, refreshPageState, type ObservePageOptions } from "./observer";

export interface SessionRunnerOptions {
  session?: BrowserSession;
  page: Page;
  actionRegistry?: ActionRegistry;
  latestState?: BrowserStateSummary;
  allowedDomains?: readonly string[];
  domBudgets?: DomBudgetOptions;
}

export interface RunActionOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  observe?: boolean;
  previousUrl?: string;
  sensitiveData?: Record<string, string>;
  newTabDetectMs?: number;
  extractionLLM?: ExtractionLLMFn;
  focusState?: FocusState;
  currentStep?: number;
  currentUrl?: string;
}

export interface RunActionsOptions extends RunActionOptions {
  stopOnFailure?: boolean;
  reobserve?: boolean;
  onAction?: (event: {
    action: RuntimeAction;
    result: ActionResult;
    page: Page;
    durationMs: number;
  }) => void | Promise<void>;
}

export class SessionRunner {
  readonly session?: BrowserSession;
  readonly actionRegistry: ActionRegistry;
  readonly allowedDomains?: readonly string[];
  readonly domBudgets?: DomBudgetOptions;

  private currentPage: Page;
  private state?: BrowserStateSummary;

  constructor(options: SessionRunnerOptions) {
    this.session = options.session;
    this.currentPage = options.page;
    this.actionRegistry = options.actionRegistry ?? createDefaultActionRegistry();
    this.state = options.latestState;
    this.allowedDomains = options.allowedDomains;
    this.domBudgets = options.domBudgets;
  }

  get page(): Page {
    return this.currentPage;
  }

  get latestState(): BrowserStateSummary | undefined {
    return this.state;
  }

  setPage(page: Page): void {
    this.currentPage = page;
    this.state = undefined;
  }

  setState(state: BrowserStateSummary | undefined): void {
    this.state = state;
  }

  async currentUrl(): Promise<string | undefined> {
    if (this.state?.url) return this.state.url;
    try {
      return await this.currentPage.currentUrl();
    } catch {
      return undefined;
    }
  }

  async observe(options: ObservePageOptions = {}): Promise<BrowserStateSummary> {
    this.state = await observePage(this.currentPage, this.session, {
      domBudgets: this.domBudgets,
      ...options,
    });
    return this.state;
  }

  async refresh(
    options: ObservePageOptions & { previousUrl?: string } = {},
  ): Promise<BrowserStateSummary> {
    this.state = await refreshPageState(this.currentPage, this.session, {
      domBudgets: this.domBudgets,
      ...options,
    });
    return this.state;
  }

  async runAction(action: Action | RegisteredAction, options: RunActionOptions = {}) {
    const executed = await executeRuntimeAction({
      page: this.currentPage,
      action,
      actionRegistry: this.actionRegistry,
      session: this.session,
      signal: options.signal,
      selectorMap: this.state?.selectorMap,
      sensitiveData: options.sensitiveData,
      newTabDetectMs: options.newTabDetectMs,
      extractionLLM: options.extractionLLM,
      focusState: options.focusState,
      snapshotElements: this.state?.elements,
      currentStep: options.currentStep,
      currentUrl: options.currentUrl,
      allowedDomains: this.allowedDomains,
      timeoutMs: options.timeoutMs,
    });
    this.currentPage = executed.page;
    if (executed.result.activeTargetId || shouldReobserve(action, executed.result)) {
      this.state = undefined;
    }
    if (options.observe === true) await this.refresh({ previousUrl: options.previousUrl });
    return executed.result;
  }

  async runActions(actions: readonly RuntimeAction[], options: RunActionsOptions = {}) {
    const executed = await runRuntimeActions({
      page: this.currentPage,
      actions,
      actionRegistry: this.actionRegistry,
      session: this.session,
      signal: options.signal,
      selectorMap: this.state?.selectorMap,
      snapshotElements: this.state?.elements,
      allowedDomains: this.allowedDomains,
      timeoutMs: options.timeoutMs,
      stopOnFailure: options.stopOnFailure,
      reobserve: options.reobserve,
      onAction: options.onAction,
    });
    this.currentPage = executed.page;
    if (
      executed.stoppedForObservation ||
      executed.results.some((result) => result.activeTargetId)
    ) {
      this.state = undefined;
    }
    if (options.observe === true) await this.refresh({ previousUrl: options.previousUrl });
    return executed;
  }
}
