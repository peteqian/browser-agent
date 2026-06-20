import { estimateCostUsd } from "../../llm/pricing";
import type { AgentOptions, AgentOutput, AgentResult } from "../decide/contracts";

export interface SpendAccumulator {
  tokens: number;
  cost: number;
}

/**
 * Accumulates this decision's token/cost spend and returns a terminal result
 * when a configured budget is crossed. The decision is already paid for, so a
 * crossed limit lets a terminal `done` finish (no further spend) but otherwise
 * stops before more actions/decisions are bought. Mutates `spend` in place;
 * returns null when within budget (or no budget configured).
 */
export function applyBudgetGuard<TData>(
  options: AgentOptions<TData>,
  decision: AgentOutput,
  spend: SpendAccumulator,
  step: number,
): AgentResult<TData> | null {
  if (!options.budget) return null;

  const usage = decision.telemetry?.usage;
  if (usage) {
    spend.tokens += usage.inputTokens + usage.outputTokens;
    const cost = estimateCostUsd(usage, decision.telemetry?.model, options.budget.pricing);
    if (cost !== null) spend.cost += cost;
  }
  const overTokens =
    typeof options.budget.maxTokens === "number" && spend.tokens > options.budget.maxTokens;
  const overCost =
    typeof options.budget.maxCostUsd === "number" && spend.cost > options.budget.maxCostUsd;
  if ((overTokens || overCost) && !decision.done) {
    return {
      success: false,
      reason: "budget_exceeded",
      summary: overTokens
        ? `Stopped: token budget exceeded (${spend.tokens} > ${options.budget.maxTokens}).`
        : `Stopped: cost budget exceeded ($${spend.cost.toFixed(4)} > $${options.budget.maxCostUsd?.toFixed(4)}).`,
      data: null,
      steps: step,
    };
  }
  return null;
}
