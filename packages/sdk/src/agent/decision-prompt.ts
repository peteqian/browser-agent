import type { AgentInput } from "./contracts";
import { SYSTEM_PROMPT } from "./prompts";

/**
 * Per-decision prompt split into a (mostly) stable prefix and a per-step
 * suffix. The prefix carries the system prompt and the action catalog and is
 * what providers should mark as cacheable (e.g. Anthropic `cache_control:
 * ephemeral`). The suffix carries the per-step observation, history, task,
 * and persistent memory — the parts that change every turn.
 */
export interface DecisionPromptParts {
  prefix: string;
  suffix: string;
}

/**
 * Build the prefix/suffix pair for a decision call. Use this when the
 * adapter can pass the prefix through a cacheable channel (system prompt
 * with cache_control) and the suffix as the per-step user message.
 *
 * The cheap concatenation `${prefix}\n\n${suffix}` is identical to the
 * legacy `buildDecisionPrompt` output.
 */
export function buildDecisionPromptParts(input: AgentInput): DecisionPromptParts {
  const prefix = `${SYSTEM_PROMPT}

Actions:
${input.actionCatalog ?? "(default actions)"}`;

  const suffix = buildDecisionSuffix(input);
  return { prefix, suffix };
}

/**
 * Formats the per-step observation payload given to the deciding model.
 *
 * Keeping prompt assembly centralized makes the CLI, server, and future
 * adapters share the same decision contract. Backwards-compatible single
 * string form for adapters that don't split system/user.
 */
export function buildDecisionPrompt(input: AgentInput): string {
  const { prefix, suffix } = buildDecisionPromptParts(input);
  return `${prefix}\n\n${suffix}`;
}

/**
 * Formats the user-message prompt for structured-output adapters that already
 * pass `SYSTEM_PROMPT` (and the action catalog) through a cached system field.
 */
export function buildDecisionUserPrompt(input: AgentInput): string {
  return buildDecisionSuffix(input);
}

function buildDecisionSuffix(input: AgentInput): string {
  const historyBlock =
    input.history.length === 0
      ? "(none)"
      : input.history.map((h, idx) => `${idx + 1}. ${h.action} => ${h.result}`).join("\n");

  const memoryBlock = input.memory ? `\nCurrent memory:\n${input.memory}\n` : "";

  return `Task: ${input.task}
Step: ${input.step}/${input.maxSteps}
Active tab: ${input.activeTab}
Open tabs: ${input.tabs.join(", ")}
${memoryBlock}
Recent action history:
${historyBlock}

Observation:
${input.observation}

Respond with the structured decision described in the system prompt.`;
}
