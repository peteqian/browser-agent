import { createDefaultActionRegistry, type ActionRegistry } from "../actions/registry";
import type { Action } from "../actions/types";
import type { BrowserStateSummary } from "../browser/state";
import type { AgentAction, AgentOptions, AgentResult } from "./contracts";
import { withRetry } from "./retry";
import { buildTerminalData } from "./terminal-result";
import { combineSignals, withDecideTimeout } from "./timeouts";

export function resolveActionRegistry(actions: AgentOptions["actions"]): ActionRegistry {
  if (!actions) return createDefaultActionRegistry();
  if (Array.isArray(actions)) {
    const registry = createDefaultActionRegistry();
    for (const action of actions) {
      registry.register(action);
    }
    return registry;
  }
  return actions;
}

export async function tryFinalFailureRecovery<TData>(input: {
  options: AgentOptions<TData>;
  task: string;
  step: number;
  browserState: BrowserStateSummary;
  observation: string;
  tabs: string[];
  activeTab: string;
  history: Array<{ action: string; result: string }>;
  decisionTimeoutMs: number;
  actionRegistry: ActionRegistry;
}): Promise<AgentResult<TData> | null> {
  try {
    const recoveryInput = {
      task: input.task,
      step: input.step,
      browserState: input.browserState,
      observation:
        `${input.observation}\n\nFINAL RECOVERY: The agent reached its consecutive failure limit. ` +
        `Return a done action or done=true summary only; do not request more browser actions.`,
      tabs: input.tabs,
      activeTab: input.activeTab,
      history: input.history,
      actionCatalog: input.actionRegistry.describeForPrompt(input.browserState),
    };
    const recoverySignal = combineSignals(input.options.signal, input.options.control?.signal);
    const decision = await withRetry(
      (sig) =>
        withDecideTimeout(
          input.options.decide,
          recoveryInput,
          input.decisionTimeoutMs,
          `Model decision timed out after ${input.decisionTimeoutMs}ms`,
          sig,
        ),
      input.options.decideRetry,
      recoverySignal.signal,
    ).finally(() => recoverySignal.cleanup());

    const doneAction = decision.actions
      ?.map((rawAction) => input.actionRegistry.parse(rawAction.name, rawAction.params))
      .find((action): action is AgentAction => action?.name === "done");

    if (doneAction) {
      const doneParams = doneAction.params as Extract<Action, { name: "done" }>["params"];
      const terminalData = buildTerminalData(doneParams.data, input.options.outputSchema);
      if (!terminalData.ok) {
        return {
          success: false,
          reason: "schema_violation",
          summary: terminalData.error,
          data: null,
          steps: input.step,
        };
      }
      return {
        success: doneParams.success,
        reason: doneParams.success ? "completed" : "failed",
        summary: doneParams.summary,
        data: terminalData.data,
        steps: input.step,
      };
    }

    if (decision.done) {
      const success = decision.success ?? false;
      return {
        success,
        reason: success ? "completed" : "failed",
        summary: decision.summary ?? "Agent stopped after repeated failures.",
        data: null,
        steps: input.step,
      };
    }

    return null;
  } catch {
    return null;
  }
}
