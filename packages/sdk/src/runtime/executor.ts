import type { ActionResult } from "../actions/handlers/shared";
import type { ActionRegistry, RegisteredAction } from "../actions/registry";
import type { Action } from "../actions/types";
import type { BrowserSession, Page } from "../browser/session";
import type { SelectorMap } from "../dom/cdp-snapshot";
import type { ElementInfo } from "../dom/types";
import type { ExtractionLLMFn } from "../agent/contracts";
import type { FocusState } from "../agent/focus-state";

export type RuntimeAction = Action | RegisteredAction;

export interface ExecuteRuntimeActionOptions {
  page: Page;
  action: RuntimeAction;
  actionRegistry: ActionRegistry;
  session?: BrowserSession;
  signal?: AbortSignal;
  selectorMap?: SelectorMap;
  sensitiveData?: Record<string, string>;
  newTabDetectMs?: number;
  extractionLLM?: ExtractionLLMFn;
  focusState?: FocusState;
  snapshotElements?: readonly ElementInfo[];
  currentStep?: number;
  currentUrl?: string;
  allowedDomains?: readonly string[];
  timeoutMs?: number;
}

export interface RuntimeActionResult {
  page: Page;
  result: ActionResult;
}

export async function executeRuntimeAction(
  options: ExecuteRuntimeActionOptions,
): Promise<RuntimeActionResult> {
  const result =
    typeof options.timeoutMs === "number" && Number.isFinite(options.timeoutMs)
      ? await executeWithTimeout(options)
      : await executeWithoutTimeout(options);
  const page =
    result.activeTargetId && options.session
      ? options.session.getPage(result.activeTargetId)
      : options.page;
  return { page, result };
}

export interface RunRuntimeActionsOptions extends Omit<ExecuteRuntimeActionOptions, "action"> {
  actions: readonly RuntimeAction[];
  stopOnFailure?: boolean;
  onAction?: (event: {
    action: RuntimeAction;
    result: ActionResult;
    page: Page;
    durationMs: number;
  }) => void | Promise<void>;
}

export interface RuntimeActionsResult {
  page: Page;
  results: ActionResult[];
  stoppedForObservation: boolean;
}

export async function runRuntimeActions(
  options: RunRuntimeActionsOptions,
): Promise<RuntimeActionsResult> {
  let page = options.page;
  const results: ActionResult[] = [];
  let stoppedForObservation = false;

  for (let actionIndex = 0; actionIndex < options.actions.length; actionIndex += 1) {
    const action = options.actions[actionIndex];
    if (!action) continue;

    const startedAt = Date.now();
    const executed = await executeRuntimeAction({ ...options, page, action });
    page = executed.page;
    results.push(executed.result);
    await options.onAction?.({
      action,
      result: executed.result,
      page,
      durationMs: Date.now() - startedAt,
    });

    if (options.stopOnFailure === true && !executed.result.ok) break;

    const nextAction = options.actions[actionIndex + 1];
    if (shouldReobserve(action, executed.result, nextAction?.name)) {
      stoppedForObservation = true;
      break;
    }
  }

  return { page, results, stoppedForObservation };
}

export function shouldReobserve(
  action: RuntimeAction,
  result: ActionResult,
  nextActionName?: string,
): boolean {
  if (!result.ok) return false;
  if (nextActionName === "done") return false;
  if (result.activeTargetId) return true;

  switch (action.name) {
    case "navigate":
    case "new_tab":
    case "switch_tab":
    case "close_tab":
    case "go_back":
    case "go_forward":
    case "refresh":
    case "click":
    case "click_by":
    case "dblclick":
    case "scroll":
    case "upload_file":
    case "wait_for_text":
    case "wait_for_condition":
    case "wait_for_url":
    case "extract_content":
    case "select_option":
    case "select_by":
    case "send_keys":
    case "press":
      return true;
    case "type":
    case "fill":
    case "type_by":
      return (action.params as { submit?: boolean }).submit === true;
    default:
      return false;
  }
}

async function executeWithoutTimeout(options: ExecuteRuntimeActionOptions): Promise<ActionResult> {
  return options.actionRegistry.execute(options.action, {
    page: options.page,
    session: options.session,
    signal: options.signal,
    selectorMap: options.selectorMap,
    sensitiveData: options.sensitiveData,
    newTabDetectMs: options.newTabDetectMs,
    extractionLLM: options.extractionLLM,
    focusState: options.focusState,
    snapshotElements: options.snapshotElements,
    currentStep: options.currentStep,
    currentUrl: options.currentUrl,
    allowedDomains: options.allowedDomains,
  });
}

async function executeWithTimeout(options: ExecuteRuntimeActionOptions): Promise<ActionResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort(options.signal?.reason);
  if (options.signal) {
    if (options.signal.aborted) controller.abort(options.signal.reason);
    else options.signal.addEventListener("abort", onAbort, { once: true });
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      executeWithoutTimeout({ ...options, signal: controller.signal }),
      new Promise<ActionResult>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort();
          const message = `Action ${options.action.name} timed out after ${options.timeoutMs}ms`;
          resolve({
            ok: false,
            message,
            extractedContent: message,
            longTermMemory: `Timed out while running ${options.action.name}`,
          });
        }, options.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (options.signal) options.signal.removeEventListener("abort", onAbort);
  }
}
