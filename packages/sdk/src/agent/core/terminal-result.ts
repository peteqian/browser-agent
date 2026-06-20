import type { AgentOptions, AgentOutput, AgentResult } from "../decide/contracts";

/**
 * Builds the terminal result for a model-signalled `done` (the decision-level
 * `done` flag, distinct from a `done` action handled in the step runner).
 * Picks the first non-empty summary candidate and passes through any data.
 */
export function buildDecisionDoneResult<TData>(
  decision: AgentOutput,
  step: number,
): AgentResult<TData> {
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

export function buildAbortedResult<TData>(steps: number): AgentResult<TData> {
  return {
    success: false,
    reason: "aborted",
    summary: "Agent run aborted.",
    data: null,
    steps,
  };
}

export function buildStoppedResult<TData>(
  options: AgentOptions<TData>,
  steps: number,
): AgentResult<TData> {
  const stopReason = options.control?.stopReason;
  return {
    success: false,
    reason: "stopped",
    summary: stopReason ? `Agent run stopped: ${stopReason}` : "Agent run stopped.",
    data: null,
    steps,
  };
}

export function buildMaxFailuresResult<TData>(
  maxFailures: number,
  lastFailureMessage: string | undefined,
  steps: number,
): AgentResult<TData> {
  return {
    success: false,
    reason: "max_failures",
    summary: `Stopped after ${maxFailures} consecutive failed step${maxFailures === 1 ? "" : "s"}: ${lastFailureMessage ?? "unknown failure"}`,
    data: null,
    steps,
  };
}

export function buildTerminalData<TData>(
  explicitData: unknown,
  outputSchema: AgentOptions<TData>["outputSchema"],
): { ok: true; data: TData | null } | { ok: false; error: string } {
  if (explicitData !== undefined) {
    if (!outputSchema) return { ok: true, data: explicitData as TData };
    const parsed = outputSchema.safeParse(explicitData);
    if (!parsed.success) {
      return {
        ok: false,
        error: `Terminal data failed output schema validation: ${parsed.error.message}`,
      };
    }
    return { ok: true, data: parsed.data };
  }
  return { ok: true, data: null };
}
