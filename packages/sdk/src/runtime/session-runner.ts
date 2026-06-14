import {
  createDefaultActionRegistry,
  type ActionRegistry,
  type RegisteredAction,
} from "../actions/registry";
import type { ActionResult } from "../actions/handlers/shared";
import type { Action } from "../actions/types";
import type { BrowserSession, Page } from "../browser/session/session";
import type { BrowserStateSummary } from "../browser/state";
import type { DomBudgetOptions } from "../dom/cdp-snapshot";
import type { ExtractionLLMFn } from "../agent/decide/contracts";
import type { FocusState } from "../agent/features/focus-state";
import {
  executeRuntimeAction,
  runRuntimeActions,
  shouldReobserve,
  type RuntimeAction,
} from "./executor";
import { observePage, refreshPageState, type ObservePageOptions } from "./observer";
import { checkPostCondition, type PostCondition } from "./post-condition";
import { RateLimiter, hostOf, type RateLimitConfig } from "./rate-limit";

export interface SessionRunnerOptions {
  session?: BrowserSession;
  page: Page;
  actionRegistry?: ActionRegistry;
  latestState?: BrowserStateSummary;
  allowedDomains?: readonly string[];
  domBudgets?: DomBudgetOptions;
  /**
   * When an index-targeted action fails because the element went stale
   * (re-render between snapshot and action), re-observe the page, re-locate
   * the element by its stable identity, and retry once. Default: true.
   */
  selfHealing?: boolean;
  /**
   * Politeness delays between actions (global and/or per host) to avoid
   * volume-based bot heuristics. Default: off.
   */
  rateLimit?: RateLimitConfig | RateLimiter;
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
  /**
   * Assertion verified after a successful action. On mismatch the result is
   * downgraded to a failure so silent no-ops surface. Caller-supplied
   * (autofill/custom harnesses) — the model does not emit these.
   */
  postCondition?: PostCondition;
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

/** Failure messages produced by index-based handlers when the DOM moved on. */
function isStaleElementFailure(message: string): boolean {
  return (
    message.includes("no longer exists in the DOM") ||
    message.includes("is not present in the current snapshot")
  );
}

export class SessionRunner {
  readonly session?: BrowserSession;
  readonly actionRegistry: ActionRegistry;
  readonly allowedDomains?: readonly string[];
  readonly domBudgets?: DomBudgetOptions;

  private currentPage: Page;
  private state?: BrowserStateSummary;
  private readonly selfHealing: boolean;
  private readonly rateLimiter?: RateLimiter;

  constructor(options: SessionRunnerOptions) {
    this.session = options.session;
    this.currentPage = options.page;
    this.actionRegistry = options.actionRegistry ?? createDefaultActionRegistry();
    this.state = options.latestState;
    this.allowedDomains = options.allowedDomains;
    this.domBudgets = options.domBudgets;
    this.selfHealing = options.selfHealing ?? true;
    if (options.rateLimit instanceof RateLimiter) {
      this.rateLimiter = options.rateLimit;
    } else if (options.rateLimit) {
      const limiter = new RateLimiter(options.rateLimit);
      this.rateLimiter = limiter.enabled ? limiter : undefined;
    }
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
    const beforeUrl = options.currentUrl ?? this.state?.url;
    if (this.rateLimiter) await this.rateLimiter.acquire(hostOf(beforeUrl));

    let executed = await this.executeOnce(action, options);

    if (
      this.selfHealing &&
      !executed.result.ok &&
      isStaleElementFailure(executed.result.message) &&
      executed.page === this.currentPage
    ) {
      const healed = await this.healStaleIndexAction(action, options);
      if (healed) executed = healed;
    }

    this.currentPage = executed.page;
    if (executed.result.activeTargetId || shouldReobserve(action, executed.result)) {
      this.state = undefined;
    }

    // Post-condition: verify the page reached the expected state. Only checked
    // for actions that otherwise succeeded — a failure already speaks for itself.
    if (options.postCondition && executed.result.ok) {
      const verdict = await checkPostCondition(
        this.currentPage,
        options.postCondition,
        beforeUrl,
      ).catch((error) => ({ ok: false, message: `post-condition check threw: ${String(error)}` }));
      if (!verdict.ok) {
        executed = {
          page: executed.page,
          result: {
            ...executed.result,
            ok: false,
            message: `${executed.result.message} — post-condition failed: ${verdict.message}`,
          },
        };
      }
    }

    if (options.observe === true) await this.refresh({ previousUrl: options.previousUrl });
    return executed.result;
  }

  private async executeOnce(action: Action | RegisteredAction, options: RunActionOptions) {
    return executeRuntimeAction({
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
  }

  /**
   * Stale-element self-healing: the snapshot the model acted on described an
   * element that the page re-rendered away. Re-observe, find the element that
   * carries the same stable identity (or the same semantic tuple), and retry
   * the action once against its new index.
   */
  private async healStaleIndexAction(
    action: Action | RegisteredAction,
    options: RunActionOptions,
  ): Promise<{ page: Page; result: ActionResult } | null> {
    const params = (action as { params?: { index?: unknown } }).params;
    const staleIndex = typeof params?.index === "number" ? params.index : null;
    if (staleIndex === null) return null;
    const before = this.state?.elements?.find((el) => el.index === staleIndex);
    if (!before) return null;

    const refreshed = await this.refresh().catch(() => null);
    if (!refreshed) return null;

    const match =
      refreshed.elements.find((el) => el.stableId === before.stableId) ??
      refreshed.elements.find(
        (el) =>
          el.tag === before.tag &&
          (el.axRole ?? el.role) === (before.axRole ?? before.role) &&
          (el.axName ?? "") === (before.axName ?? "") &&
          (el.testId ?? "") === (before.testId ?? ""),
      );
    if (!match) return null;

    const healedAction = {
      ...action,
      params: { ...(params as Record<string, unknown>), index: match.index },
    } as Action;
    const retried = await this.executeOnce(healedAction, options);
    if (!retried.result.ok) return null;

    await this.session?.eventBus?.emit({
      type: "browser_event",
      name: "self_heal",
      data: {
        action: action.name,
        staleIndex,
        healedIndex: match.index,
        stableId: before.stableId,
      },
    });
    return {
      page: retried.page,
      result: {
        ...retried.result,
        message: `${retried.result.message} (self-healed: element re-located after DOM change)`,
      },
    };
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
