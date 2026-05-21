import { BrowserSession, type Page } from "../browser/session";
import type { PageSnapshot } from "../dom/types";
import type { AgentInput, AgentOptions, AgentOutput, AgentResult } from "./contracts";
import { emitEvent } from "./emit";
import { compactHistory } from "./history";
import {
  buildLoopFingerprint,
  canonicaliseActionCall,
  detectAlternatingPair,
  detectSameNameRun,
  isRepeatingLoop,
} from "./loop-detection";
import {
  DEFAULT_HISTORY_HEAD,
  HISTORY_WINDOW,
  coerceActionTimeoutMs,
  coerceDecisionTimeoutMs,
  coerceLoopDetectionWindow,
  coerceMaxFailures,
  coerceStepTimeoutMs,
} from "./options";
import { resolveActionRegistry, tryFinalFailureRecovery } from "./recovery";
import { withRetry } from "./retry";
import { buildStepContext, type StepContext } from "./step-context";
import { checkInterrupt, runActions, type StepOutcome } from "./step-runner";
import { buildMaxFailuresResult } from "./terminal-result";
import { createFocusState } from "./focus-state";
import { combineSignals, withDecideTimeout, withRejectingTimeout } from "./timeouts";

export { AgentController } from "./controller";
export { compactHistory } from "./history";
export {
  buildDecisionPrompt,
  buildDecisionPromptParts,
  buildDecisionUserPrompt,
} from "./decision-prompt";
export type { DecisionPromptParts } from "./decision-prompt";

/**
 * Runs the core browser-agent loop until completion, abort, or step-budget
 * exhaustion.
 *
 * The loop owns the session lifecycle when no caller-provided page/session is
 * given; otherwise it leaves cleanup to the caller.
 */
export async function runAgent<TData = unknown>(
  options: AgentOptions<TData>,
): Promise<AgentResult<TData>> {
  if (options.transportResolution) {
    await emitEvent(options, {
      type: "transport_resolved",
      resolution: options.transportResolution,
    });
  }
  const result = await runAgentInner<TData>(options);
  await emitEvent(options, { type: "terminal", result });
  return result;
}

async function runAgentInner<TData = unknown>(
  options: AgentOptions<TData>,
): Promise<AgentResult<TData>> {
  const cfg = resolveConfig(options);
  const actionRegistry = resolveActionRegistry(options.actions);

  const ownsSession = !options.session && !options.page;
  const session =
    options.session ??
    (ownsSession ? await BrowserSession.launch(options.launch ?? {}) : undefined);
  let unsubscribeBrowserEvents: (() => void) | undefined;

  const actionHistory: Array<{ action: string; result: string }> = [];
  const loopFingerprints: string[] = [];
  const recentActionCalls: string[] = [];
  const recentActionNames: string[] = [];
  const focusState = createFocusState();
  let consecutiveFailures = 0;
  let loopNudgesUsed = 0;
  let pendingLoopNotice: string | null = null;
  let latestExtraction: string | null = null;
  let currentMemory: string | undefined = options.memory;
  let prevSnapshot: PageSnapshot | null = null;
  const fullSnapshots = options.fullSnapshots === true;

  try {
    const initialPage = options.page ?? (session ? await session.newPage() : undefined);
    if (!initialPage) {
      throw new Error("No page available — provide options.page or options.session.");
    }
    let page: Page = initialPage;

    unsubscribeBrowserEvents = session?.eventBus?.on((event) =>
      emitEvent(options, { type: "browser_event", event }),
    );

    if (options.startUrl) {
      const health = await page.navigateWithHealthCheck(options.startUrl);
      if (!health.ok) {
        return {
          success: false,
          reason: "failed",
          summary: `Start URL navigation failed: ${health.warning ?? health.status}`,
          data: null,
          steps: 0,
        };
      }
    }

    for (let step = 1; step <= cfg.maxSteps; step++) {
      const beforeStepInterrupt = await checkInterrupt(options, step - 1);
      if (beforeStepInterrupt) return beforeStepInterrupt;

      await emitEvent(options, { type: "snapshot_started", stepIndex: step });
      const snapshotStartedAt = Date.now();
      let context: StepContext;
      try {
        context = await withRejectingTimeout(
          buildStepContext(
            page,
            session,
            cfg.vision,
            options.domBudgets,
            focusState,
            fullSnapshots ? null : prevSnapshot,
          ),
          cfg.stepTimeoutMs,
          `Step context preparation timed out after ${cfg.stepTimeoutMs}ms`,
        );
      } catch (error) {
        return {
          success: false,
          reason: "step_timeout",
          summary: error instanceof Error ? error.message : String(error),
          data: null,
          steps: step,
        };
      }

      const { browserState, observation, tabs } = context;
      prevSnapshot = browserState.snapshot;
      const snapshotDurationMs = Date.now() - snapshotStartedAt;
      const snapshotBytes = observation.length;
      const snapshotElementCount = browserState.elements?.length ?? 0;
      await emitEvent(options, {
        type: "snapshot_captured",
        stepIndex: step,
        durationMs: snapshotDurationMs,
        elementCount: snapshotElementCount,
        bytes: snapshotBytes,
      });
      await session?.eventBus?.emit({ type: "browser_state", state: browserState });
      await emitEvent(options, { type: "browser_state", step, state: browserState });
      if (browserState.screenshot) {
        await session?.eventBus?.emit({
          type: "screenshot",
          targetId: page.targetId,
          screenshot: browserState.screenshot,
        });
        await emitEvent(options, {
          type: "screenshot",
          step,
          screenshot: browserState.screenshot,
        });
      }

      const effectiveObservation = applyObservationPrefix(observation, {
        isLastStep: Number.isFinite(cfg.maxSteps) && step === cfg.maxSteps,
        step,
        maxSteps: cfg.maxSteps,
        loopNotice: pendingLoopNotice,
        latestExtraction,
      });
      pendingLoopNotice = null;
      // Consume the extraction once — keep it visible only for the
      // turn after the call; the agent should incorporate it then or
      // re-extract if it needs a fresh snapshot.
      latestExtraction = null;

      const decideInput: AgentInput = {
        task: options.task,
        step,
        maxSteps: cfg.maxSteps,
        browserState,
        observation: effectiveObservation,
        tabs,
        activeTab: page.targetId,
        history: compactHistory(actionHistory, cfg.historyHead, cfg.historyTail),
        actionCatalog: actionRegistry.describeForPrompt(browserState),
        memory: currentMemory,
      };

      const provider = options.transportResolution?.provider ?? "unknown";
      const decisionStartedAt = Date.now();
      await emitEvent(options, {
        type: "decision_started",
        stepIndex: step,
        provider,
        model: "",
      });
      let decision: AgentOutput;
      try {
        decision = await runDecide(options, decideInput, cfg.decisionTimeoutMs);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          reason: message.includes("Model decision timed out")
            ? "decision_timeout"
            : "decide_error",
          summary: `Model decision failed: ${message}`,
          data: null,
          steps: step,
        };
      }

      await emitEvent(options, {
        type: "decision_completed",
        stepIndex: step,
        durationMs: Date.now() - decisionStartedAt,
        tokensIn: decision.telemetry?.usage?.inputTokens,
        tokensOut: decision.telemetry?.usage?.outputTokens,
        cacheReadTokens: decision.telemetry?.usage?.cachedInputTokens,
        cacheCreationTokens: decision.telemetry?.usage?.cacheCreationTokens,
      });

      if (typeof decision.memory === "string") currentMemory = decision.memory;
      if (cfg.planning && (decision.plan || decision.memory || decision.nextGoal)) {
        await emitEvent(options, {
          type: "planning",
          step,
          plan: decision.plan,
          memory: decision.memory,
          nextGoal: decision.nextGoal,
        });
      }
      await emitEvent(options, { type: "decision", step, decision });

      const stepOutcome: StepOutcome<TData> = await runActions<TData>({
        options,
        actionRegistry,
        decision,
        decideInput,
        page,
        session,
        step,
        browserState,
        actionTimeoutMs: cfg.actionTimeoutMs,
        actionHistory,
        focusState,
      });

      page = stepOutcome.page;
      if (stepOutcome.latestExtraction) {
        // Cap the surfaced extraction so the next prompt does not blow up
        // for sites that return tens of kilobytes of page text.
        const cap = 8_000;
        latestExtraction =
          stepOutcome.latestExtraction.length > cap
            ? `${stepOutcome.latestExtraction.slice(0, cap)}\n…[truncated ${
                stepOutcome.latestExtraction.length - cap
              } chars]`
            : stepOutcome.latestExtraction;
      }
      if (stepOutcome.terminalResult) return stepOutcome.terminalResult;

      // Track canonicalised action calls so we can surface a nudge as soon
      // as the agent repeats itself (legacy window-based handleLoopDetection
      // still owns the hard-fail decision so existing tests stay green).
      if (cfg.loopDetectionMode !== "off") {
        for (const a of decision.actions ?? []) {
          recentActionCalls.push(canonicaliseActionCall(a.name, a.params));
          recentActionNames.push(a.name);
        }
        while (recentActionCalls.length > 8) recentActionCalls.shift();
        while (recentActionNames.length > 8) recentActionNames.shift();
      }

      // Coarser nudge: if the model keeps reaching for the same *kind* of
      // action with cosmetically different params (classic case: `eval` with
      // a slightly different selector each turn), the fingerprint detector
      // never trips because the params differ. Detect 4+ consecutive same
      // action names and prod the model toward an alternative.
      const sameNameNudge = detectSameNameRun(recentActionNames, 4);
      const alternatingNudge = sameNameNudge ? null : detectAlternatingPair(recentActionNames, 3);
      const triggeredNudge =
        sameNameNudge && buildSameNameNudge(sameNameNudge)
          ? buildSameNameNudge(sameNameNudge)
          : alternatingNudge
            ? buildAlternatingNudge(alternatingNudge)
            : null;
      if (
        triggeredNudge &&
        cfg.loopDetectionMode === "nudge" &&
        loopNudgesUsed < cfg.loopNudgeBudget &&
        !pendingLoopNotice
      ) {
        loopNudgesUsed += 1;
        pendingLoopNotice = triggeredNudge;
        await emitEvent(options, {
          type: "loop_nudge",
          step,
          notice: pendingLoopNotice,
          nudgesUsed: loopNudgesUsed,
          budget: cfg.loopNudgeBudget,
        });
        recentActionNames.length = 0;
      }

      // Loop-detection bookkeeping.
      if (cfg.loopDetectionMode !== "off" && stepOutcome.actionResults.length > 0) {
        const detection = handleLoopDetection({
          loopFingerprints,
          browserState,
          actionResults: stepOutcome.actionResults,
          recentActionCalls,
          window: cfg.loopDetectionWindow,
          mode: cfg.loopDetectionMode,
          nudgesUsed: loopNudgesUsed,
          nudgeBudget: cfg.loopNudgeBudget,
        });
        if (detection.kind === "stop") {
          return {
            success: false,
            reason: "loop_detected",
            summary: `Stopped after detecting a repeated action loop over ${cfg.loopDetectionWindow} steps.`,
            data: null,
            steps: step,
          };
        }
        if (detection.kind === "nudge") {
          loopNudgesUsed = detection.nudgesUsed;
          pendingLoopNotice = detection.notice;
          await emitEvent(options, {
            type: "loop_nudge",
            step,
            notice: detection.notice,
            nudgesUsed: loopNudgesUsed,
            budget: cfg.loopNudgeBudget,
          });
        } else if (detection.kind === "reset") {
          loopNudgesUsed = 0;
        }
      }

      // Consecutive-failure bookkeeping.
      const stepFailed =
        stepOutcome.actionResults.length > 0 && stepOutcome.actionResults.every((r) => !r.ok);
      if (stepFailed) {
        consecutiveFailures += 1;
        if (consecutiveFailures >= cfg.maxFailures) {
          const lastFailure =
            stepOutcome.actionResults[stepOutcome.actionResults.length - 1]?.message;
          const failureResult = buildMaxFailuresResult<TData>(cfg.maxFailures, lastFailure, step);
          if (!cfg.finalResponseAfterFailure || options.signal?.aborted) return failureResult;

          const recoveryResult = await tryFinalFailureRecovery<TData>({
            options,
            task: options.task,
            step,
            maxSteps: cfg.maxSteps,
            browserState,
            observation,
            tabs,
            activeTab: page.targetId,
            history: compactHistory(actionHistory, cfg.historyHead, cfg.historyTail),
            decisionTimeoutMs: cfg.decisionTimeoutMs,
            actionRegistry,
          });
          return recoveryResult ?? failureResult;
        }
      } else if (stepOutcome.actionResults.length > 0 && consecutiveFailures > 0) {
        consecutiveFailures = 0;
      }

      if (decision.done) {
        const success = decision.success ?? true;
        const doneParams = (decision.actions[0]?.params ?? {}) as {
          summary?: unknown;
          data?: unknown;
        };
        const candidates = [
          decision.summary,
          typeof doneParams.summary === "string" ? doneParams.summary : undefined,
          decision.thought,
          decision.nextGoal,
        ];
        const summary =
          candidates.find((s): s is string => typeof s === "string" && s.trim().length > 0) ??
          "Agent signaled done.";
        return {
          success,
          reason: success ? "completed" : "failed",
          summary,
          data: (doneParams.data ?? null) as never,
          steps: step,
        };
      }
    }

    const stepsRun = Number.isFinite(cfg.maxSteps) ? (cfg.maxSteps as number) : 0;
    return {
      success: false,
      reason: "max_steps",
      summary: `Exceeded max steps (${stepsRun}).`,
      data: null,
      steps: stepsRun,
    };
  } finally {
    unsubscribeBrowserEvents?.();
    if (ownsSession && session) await session.close();
  }
}

interface ResolvedConfig {
  maxSteps: number;
  stepTimeoutMs: number;
  actionTimeoutMs: number;
  decisionTimeoutMs: number;
  maxFailures: number;
  finalResponseAfterFailure: boolean;
  loopDetectionMode: "nudge" | "strict" | "off";
  loopDetectionWindow: number;
  loopNudgeBudget: number;
  vision: boolean | "auto";
  planning: boolean;
  historyHead: number;
  historyTail: number;
}

function resolveConfig<TData>(options: AgentOptions<TData>): ResolvedConfig {
  const loopDetectionMode = options.loopDetectionMode ?? "nudge";
  const requestedMaxSteps = options.maxSteps;
  // Treat `0` as "uncapped" so callers can opt out of the step ceiling
  // explicitly. `undefined` still falls back to the default (40).
  const maxSteps = requestedMaxSteps === 0 ? Number.POSITIVE_INFINITY : (requestedMaxSteps ?? 40);
  return {
    maxSteps,
    stepTimeoutMs: coerceStepTimeoutMs(options.stepTimeoutMs),
    actionTimeoutMs: coerceActionTimeoutMs(options.actionTimeoutMs),
    decisionTimeoutMs: coerceDecisionTimeoutMs(options.decisionTimeoutMs),
    maxFailures: coerceMaxFailures(options.maxFailures),
    finalResponseAfterFailure: options.finalResponseAfterFailure ?? true,
    loopDetectionMode,
    loopDetectionWindow: coerceLoopDetectionWindow(options.loopDetectionWindow),
    loopNudgeBudget: Math.max(1, options.loopDetectionNudgeBudget ?? 2),
    vision: options.vision ?? "auto",
    planning: options.planning ?? true,
    historyHead: options.historyHead ?? DEFAULT_HISTORY_HEAD,
    historyTail: options.historyTail ?? HISTORY_WINDOW,
  };
}

function applyObservationPrefix(
  observation: string,
  opts: {
    isLastStep: boolean;
    step: number;
    maxSteps: number;
    loopNotice: string | null;
    latestExtraction: string | null;
  },
): string {
  const prefixes: string[] = [];
  if (opts.isLastStep) {
    prefixes.push(
      `FINAL STEP (${opts.step}/${opts.maxSteps}): No further actions will be executed after this turn. Respond with the \`done\` action — set success=true if the task is complete or success=false with a summary of remaining work otherwise.`,
    );
  }
  if (opts.loopNotice) prefixes.push(opts.loopNotice);
  if (opts.latestExtraction) {
    prefixes.push(
      `LATEST EXTRACTION (from your prior extract_content call):\n${opts.latestExtraction}`,
    );
  }
  return prefixes.length === 0 ? observation : `${prefixes.join("\n\n")}\n\n${observation}`;
}

async function runDecide<TData>(
  options: AgentOptions<TData>,
  decideInput: AgentInput,
  decisionTimeoutMs: number,
): Promise<AgentOutput> {
  const parentSignal = combineSignals(options.signal, options.control?.signal);
  try {
    return await withRetry(
      (sig) =>
        withDecideTimeout(
          options.decide,
          decideInput,
          decisionTimeoutMs,
          `Model decision timed out after ${decisionTimeoutMs}ms`,
          sig,
        ),
      options.decideRetry,
      parentSignal.signal,
    );
  } finally {
    parentSignal.cleanup();
  }
}

type LoopDetectionOutcome =
  | { kind: "stop" }
  | { kind: "nudge"; notice: string; nudgesUsed: number }
  | { kind: "reset" }
  | { kind: "noop" };

function handleLoopDetection(input: {
  loopFingerprints: string[];
  browserState: import("../browser/state").BrowserStateSummary;
  actionResults: Array<{ ok: boolean; message: string }>;
  recentActionCalls: readonly string[];
  window: number;
  mode: "nudge" | "strict";
  nudgesUsed: number;
  nudgeBudget: number;
}): LoopDetectionOutcome {
  const fingerprint = buildLoopFingerprint(input.browserState, input.actionResults);
  // Additionally fold in the canonicalised action-name signature of the
  // latest step so that calls with identical params other than `index`
  // do not bypass the legacy fingerprint just because the message text
  // includes the index number.
  const callSig = input.recentActionCalls.at(-1) ?? "";
  const composite = `${fingerprint}|${callSig}`;
  input.loopFingerprints.push(composite);
  if (input.loopFingerprints.length > input.window) input.loopFingerprints.shift();

  if (isRepeatingLoop(input.loopFingerprints, input.window)) {
    if (input.mode === "strict" || input.nudgesUsed >= input.nudgeBudget) {
      return { kind: "stop" };
    }
    const nudgesUsed = input.nudgesUsed + 1;
    const notice = `Stagnation notice: the last ${input.window} steps repeated the same action and produced the same page state. Try a different approach — change parameters, target a different element, or call \`done\` if you cannot make progress. (nudge ${nudgesUsed}/${input.nudgeBudget})`;
    return { kind: "nudge", notice, nudgesUsed };
  }

  return input.nudgesUsed > 0 ? { kind: "reset" } : { kind: "noop" };
}

const ALTERNATIVES_BY_NAME: Record<string, string> = {
  eval: "screenshot (with annotate=true), find_elements, find_by_role, find_by_text, or extract_content",
  find_elements: "find_by_role, find_by_text, find_by_testid, snapshot refs, or extract_content",
  search_page: "snapshot refs, find_by_text, or extract_content with a tighter query",
  scroll: "click_by on a 'Next' / 'Load more' control, or extract_content with startFromChar",
};

function buildSameNameNudge(run: { name: string; count: number }): string {
  const alt = ALTERNATIVES_BY_NAME[run.name] ?? "a different action";
  return (
    `Stagnation notice: \`${run.name}\` has been called ${run.count} times in a row. ` +
    `The variations aren't producing new information. Switch tactic — try ${alt}. ` +
    `If you have what you need, call \`done\` now.`
  );
}

function buildAlternatingNudge(pair: { a: string; b: string; pairs: number }): string {
  return (
    `Stagnation notice: you have alternated \`${pair.a}\` and \`${pair.b}\` for ${pair.pairs} cycles. ` +
    `This is the same loop pattern. Either commit the value you've already extracted to memory and emit \`done\`, ` +
    `or switch strategy entirely.`
  );
}
