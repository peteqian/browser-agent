import type { ActionResult } from "../actions/execute";
import type { ActionRegistry } from "../actions/registry";
import type { Action } from "../actions/types";
import type { BrowserSession, Page } from "../browser/session";
import type { BrowserStateSummary } from "../browser/state";
import type { AgentAction, AgentInput, AgentOptions, AgentOutput, AgentResult } from "./contracts";
import { emitEvent } from "./emit";
import { buildAbortedResult, buildStoppedResult, buildTerminalData } from "./terminal-result";
import { combineSignals, executeActionWithTimeout } from "./timeouts";

export interface StepOutcome<TData> {
  page: Page;
  actionResults: Array<{ ok: boolean; message: string }>;
  terminalResult: AgentResult<TData> | null;
  /** Latest extract_content output from this step, if any — surfaced to the next observation. */
  latestExtraction?: string;
}

export async function checkInterrupt<TData>(
  options: AgentOptions<TData>,
  steps: number,
): Promise<AgentResult<TData> | null> {
  if (options.signal?.aborted) return buildAbortedResult(steps);
  if (!options.control) return null;
  if (options.control.signal.aborted) return buildStoppedResult(options, steps);

  await options.control.waitIfPaused();

  if (options.control.signal.aborted) return buildStoppedResult(options, steps);
  if (options.signal?.aborted) return buildAbortedResult(steps);
  return null;
}

export async function runActions<TData>(input: {
  options: AgentOptions<TData>;
  actionRegistry: ActionRegistry;
  decision: AgentOutput;
  decideInput: AgentInput;
  page: Page;
  session: BrowserSession | undefined;
  step: number;
  browserState: BrowserStateSummary;
  actionTimeoutMs: number;
  actionHistory: Array<{ action: string; result: string }>;
  focusState?: import("./focus-state").FocusState;
}): Promise<StepOutcome<TData>> {
  const {
    options,
    actionRegistry,
    decision,
    decideInput,
    session,
    step,
    browserState,
    actionTimeoutMs,
    actionHistory,
  } = input;
  let { page } = input;

  const actions = decision.actions ?? [];
  const actionResults: Array<{ ok: boolean; message: string }> = [];
  let latestExtraction: string | undefined;

  for (const rawAction of actions) {
    const interrupt = await checkInterrupt(options, step);
    if (interrupt) return { page, actionResults, terminalResult: interrupt };

    const action = actionRegistry.parse(rawAction.name, rawAction.params);
    if (!action) {
      actionResults.push({ ok: false, message: "Invalid action payload" });
      actionHistory.push({ action: rawAction.name, result: "Invalid action payload" });
      continue;
    }

    await session?.eventBus?.emit({ type: "action_start", step, action });
    await emitEvent(options, { type: "action_start", step, action });
    await emitEvent(options, { type: "action_started", stepIndex: step, action: action.name });

    const actionStartedAt = Date.now();
    const parentSignal = combineSignals(options.signal, options.control?.signal);
    let result: ActionResult;
    try {
      result = await executeActionWithTimeout(
        page,
        action,
        session,
        actionRegistry,
        actionTimeoutMs,
        parentSignal.signal,
        browserState.selectorMap,
        options.sensitiveData,
        options.newTabDetectMs,
        options.extractionLLM,
        {
          focusState: input.focusState,
          snapshotElements: browserState.elements,
          currentStep: step,
          currentUrl: browserState.url,
          allowedDomains: options.allowedDomains,
        },
      );
    } finally {
      parentSignal.cleanup();
    }

    await emitEvent(options, {
      type: "action_completed",
      stepIndex: step,
      action: action.name,
      durationMs: Date.now() - actionStartedAt,
      ok: result.ok,
    });

    actionResults.push({ ok: result.ok, message: result.message });
    if (result.activeTargetId && session) page = session.getPage(result.activeTargetId);
    if (
      action.name === "extract_content" &&
      typeof result.extractedContent === "string" &&
      result.extractedContent.length > 0
    ) {
      latestExtraction = result.extractedContent;
    }

    const stepInfo = {
      step,
      url: browserState.url,
      action,
      result: { ok: result.ok, message: result.message },
    };
    options.onStep?.(stepInfo);
    await session?.eventBus?.emit({ type: "action_end", step, action, result });
    await emitEvent(options, { type: "action", ...stepInfo });

    actionHistory.push({
      action: `${action.name}(${JSON.stringify(action.params)})`,
      result: result.longTermMemory ?? result.message,
    });

    const terminal = await maybeTerminal<TData>({
      action,
      decideInput,
      result,
      options,
      step,
    });
    if (terminal) return { page, actionResults, terminalResult: terminal, latestExtraction };

    // Multi-action safety: if the action navigated to a new URL or attached
    // a new tab, abandon the rest of the intra-step batch and force a fresh
    // observation on the next step. Locators planned against the old DOM
    // are now invalid.
    if (
      result.activeTargetId ||
      action.name === "navigate" ||
      action.name === "go_back" ||
      action.name === "go_forward" ||
      action.name === "refresh"
    ) {
      break;
    }
  }

  return { page, actionResults, terminalResult: null, latestExtraction };
}

async function maybeTerminal<TData>(input: {
  action: AgentAction;
  decideInput: AgentInput;
  result: ActionResult;
  options: AgentOptions<TData>;
  step: number;
}): Promise<AgentResult<TData> | null> {
  const { action, decideInput, result, options, step } = input;

  if (action.name === "done") {
    return resolveDoneTerminal({ action, decideInput, options, step });
  }

  if (action.name === "close_browser" && result.ok) {
    return {
      success: true,
      reason: "completed",
      summary: result.message,
      data: null,
      steps: step,
    };
  }

  return null;
}

async function resolveDoneTerminal<TData>(input: {
  action: AgentAction;
  decideInput: AgentInput;
  options: AgentOptions<TData>;
  step: number;
}): Promise<AgentResult<TData>> {
  const { action, decideInput, options, step } = input;
  const doneParams = action.params as Extract<Action, { name: "done" }>["params"];
  const terminalData = buildTerminalData(doneParams.data, options.outputSchema);
  if (!terminalData.ok) {
    return {
      success: false,
      reason: "schema_violation",
      summary: terminalData.error,
      data: null,
      steps: step,
    };
  }
  if (doneParams.success && options.judge) {
    const judgeSignal = combineSignals(options.signal, options.control?.signal);
    try {
      const verdict = await options.judge({
        finalInput: decideInput,
        summary: doneParams.summary,
        data: terminalData.data,
        signal: judgeSignal.signal,
      });
      if (verdict.pass) {
        return {
          success: true,
          reason: "completed",
          summary: doneParams.summary,
          data: terminalData.data,
          steps: step,
        };
      }
      return {
        success: false,
        reason: "judge_failed",
        summary: verdict.reason
          ? `${doneParams.summary} (judge rejected: ${verdict.reason})`
          : `${doneParams.summary} (judge rejected)`,
        data: terminalData.data,
        steps: step,
      };
    } finally {
      judgeSignal.cleanup();
    }
  }
  return {
    success: doneParams.success,
    reason: doneParams.success ? "completed" : "failed",
    summary: doneParams.summary,
    data: terminalData.data,
    steps: step,
  };
}
