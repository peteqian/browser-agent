import type { AgentInput } from "./contracts";
import { SYSTEM_PROMPT } from "./prompts";

/**
 * Formats the per-step observation payload given to the deciding model.
 *
 * Keeping prompt assembly centralized makes the CLI, server, and future
 * adapters share the same decision contract.
 */
export function buildDecisionPrompt(input: AgentInput): string {
  return `${SYSTEM_PROMPT}

${buildDecisionUserPrompt(input)}`;
}

/**
 * Formats the user-message prompt for structured-output adapters that already
 * pass `SYSTEM_PROMPT` through the SDK's dedicated system/systemPrompt field.
 */
export function buildDecisionUserPrompt(input: AgentInput): string {
  const historyBlock =
    input.history.length === 0
      ? "(none)"
      : input.history.map((h, idx) => `${idx + 1}. ${h.action} => ${h.result}`).join("\n");

  const memoryBlock = input.memory ? `\nCurrent memory:\n${input.memory}\n` : "";

  return `Task: ${input.task}
Step: ${input.step}/${input.maxSteps}
Active tab: ${input.activeTab}
Open tabs: ${input.tabs.join(", ")}
Actions:
${input.actionCatalog ?? "(default actions)"}
${memoryBlock}
Recent action history:
${historyBlock}

Observation:
${input.observation}

Respond with the structured decision described in the system prompt.`;
}
