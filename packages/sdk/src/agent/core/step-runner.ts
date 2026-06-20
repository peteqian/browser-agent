import type { ActionResult } from "../../actions/handlers/shared";
import type { ActionRegistry } from "../../actions/registry";
import type { Action } from "../../actions/types";
import type { Page } from "../../browser/session/session";
import type { BrowserStateSummary } from "../../browser/state";
import { shouldReobserve } from "../../runtime/executor";
import type { SessionRunner } from "../../runtime/session-runner";
import type { AgentAction, AgentInput, AgentOptions, AgentOutput, AgentResult } from "../decide/contracts";
import { emitEvent } from "../observe/emit";
import { buildAbortedResult, buildStoppedResult, buildTerminalData } from "./terminal-result";
import { combineSignals } from "./timeouts";

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
  runner: SessionRunner;
  step: number;
  browserState: BrowserStateSummary;
  actionTimeoutMs: number;
  actionHistory: Array<{ action: string; result: string }>;
  focusState?: import("../features/focus-state").FocusState;
}): Promise<StepOutcome<TData>> {
  const {
    options,
    actionRegistry,
    decision,
    decideInput,
    step,
    browserState,
    actionTimeoutMs,
    actionHistory,
  } = input;
  const { runner } = input;

  const actions = decision.actions ?? [];
  const actionResults: Array<{ ok: boolean; message: string }> = [];
  let latestExtraction: string | undefined;

  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const rawAction = actions[actionIndex];
    if (!rawAction) continue;
    const interrupt = await checkInterrupt(options, step);
    if (interrupt) return { page: runner.page, actionResults, terminalResult: interrupt };

    const parseResult = actionRegistry.parseDetailed(rawAction.name, rawAction.params);
    if (!parseResult.ok) {
      const detail =
        parseResult.reason === "unknown_name"
          ? `Unknown action name "${rawAction.name}"${parseResult.suggestion ? ` — did you mean "${parseResult.suggestion}"?` : ""}. Use only names from the catalog.`
          : `Schema validation failed for "${rawAction.name}": ${parseResult.issues}`;
      actionResults.push({ ok: false, message: detail });
      actionHistory.push({ action: rawAction.name, result: detail });
      continue;
    }
    const action = parseResult.action;

    await runner.session?.eventBus?.emit({ type: "action_start", step, action });
    await emitEvent(options, { type: "action_start", step, action });
    await emitEvent(options, { type: "action_started", stepIndex: step, action: action.name });

    const actionStartedAt = Date.now();
    const parentSignal = combineSignals(options.signal, options.control?.signal);
    let result;
    try {
      result = await runner.runAction(action, {
        signal: parentSignal.signal,
        sensitiveData: options.sensitiveData,
        newTabDetectMs: options.newTabDetectMs,
        extractionLLM: options.extractionLLM,
        focusState: input.focusState,
        currentStep: step,
        currentUrl: browserState.url,
        timeoutMs: actionTimeoutMs,
      });
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
    await runner.session?.eventBus?.emit({ type: "action_end", step, action, result });
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
    if (terminal)
      return { page: runner.page, actionResults, terminalResult: terminal, latestExtraction };

    const nextRawAction = actions[actionIndex + 1];
    if (shouldReobserve(action, result, nextRawAction?.name)) {
      break;
    }
  }

  return { page: runner.page, actionResults, terminalResult: null, latestExtraction };
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
