import { MAX_ACTIONS_PER_DECISION } from "../../llm/decision/decisionSchema";
import type { AgentInput, AgentOutput } from "./contracts";

/**
 * Builds the per-step prompt body for freeform-text adapters (CLI binaries
 * and Agent SDKs). Includes an explicit JSON shape directive because these
 * transports cannot enforce structured output the way the OpenAI/Anthropic
 * SDKs can via response_format / tool calls.
 *
 * Does NOT prepend the system prompt. Callers either inline it themselves
 * or pass it through the SDK's dedicated systemPrompt option.
 */
export function buildFreeformDecisionPrompt(input: AgentInput): string {
  const historyBlock =
    input.history.length === 0
      ? "(none)"
      : input.history.map((h, idx) => `${idx + 1}. ${h.action} => ${h.result}`).join("\n");

  return `Task: ${input.task}
Step: ${input.step}
Active tab: ${input.activeTab}
Open tabs: ${input.tabs.join(", ")}
Actions:
${input.actionCatalog ?? "(default actions)"}

Recent action history:
${historyBlock}

Observation:
${input.observation}

Return exactly one JSON object (no markdown, no surrounding prose) with either this single-action shape:
{"name":"<action_name>","params":{...}}

or this batched shape:
{"actions":[{"name":"<action_name>","params":{...}}],"done":false}

\`name\` MUST be one of the action names from the Actions list above. \`params\` MUST match that action's schema. Do not invent action names. Batch at most ${MAX_ACTIONS_PER_DECISION} actions and only when every action uses the current observation; put navigation/click/submit actions last. If no listed action fits, call \`done\` with success=false explaining why.

Optional top-level fields: "thought" (one-line reasoning), "nextGoal" (next step you intend), "memory" (compact note carried forward).

Good example:
{"thought":"page loaded","nextGoal":"extract H1","name":"extract_content","params":{"query":"H1"}}

When you finish the task, call \`done\` with the answer in params.summary (and params.success=true). Done example:
{"name":"done","params":{"success":true,"summary":"The H1 reads: Example Domain"}}

BAD examples (these will be rejected):
- Wrapping prose around JSON ("Here is my decision: { ... }")
- Markdown code fences
- An action name not in the Actions catalog (e.g. "click_search_button" when only "click_by" exists)
- Missing required params for the chosen action

The only output is one JSON object. Nothing before it, nothing after it.`;
}

/**
 * Lean per-turn body for a PERSISTENT thread/conversation. The system prompt,
 * task, action catalog, and JSON-shape rules were sent on the first turn and
 * are carried by the thread, so here we send only what changed: the new
 * observation and current tab state. This is the per-step token win that keeps
 * a warm thread fast instead of re-ingesting the full prompt every step.
 *
 * The action catalog is included only when it differs from what was last sent
 * (state-scoped custom actions can appear/disappear between turns).
 */
export function buildContinuationPrompt(
  input: AgentInput,
  opts: { includeCatalog: boolean } = { includeCatalog: false },
): string {
  const catalogBlock = opts.includeCatalog
    ? `\nUpdated actions:\n${input.actionCatalog ?? "(default actions)"}\n`
    : "";
  return `Step: ${input.step}
Active tab: ${input.activeTab}
Open tabs: ${input.tabs.join(", ")}
${catalogBlock}
Observation:
${input.observation}

Return exactly one JSON object for your next action (same shape and rules as before).`;
}

/**
 * Parses freeform-text model output into an AgentOutput. Tolerates markdown
 * code fences and surrounding prose by extracting the first balanced JSON
 * object from the text.
 */
export function parseDecision(raw: string): AgentOutput {
  const cleaned = stripCodeFences(raw);
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(cleaned) as Record<string, unknown>;
  } catch {
    const extracted = extractFirstJsonObject(cleaned);
    if (extracted) {
      parsed = JSON.parse(extracted) as Record<string, unknown>;
    }
  }
  if (!parsed) {
    throw new Error("Decision response missing action name");
  }

  if (Array.isArray(parsed.actions)) {
    const actions = parsed.actions.slice(0, MAX_ACTIONS_PER_DECISION).map((item) => {
      if (!item || typeof item !== "object") {
        throw new Error("Decision action is not an object");
      }
      const action = item as Record<string, unknown>;
      if (typeof action.name !== "string") {
        throw new Error("Decision action missing name");
      }
      return { name: action.name, params: action.params ?? {} };
    });
    const doneAction = actions.find((a) => a.name === "done");
    const done = typeof parsed.done === "boolean" ? parsed.done : Boolean(doneAction);
    // A done action carries its summary/success in params (see prompt's done
    // example). Fall back to those when the model omits the top-level fields.
    const doneParams = (doneAction?.params ?? {}) as Record<string, unknown>;
    const summary =
      typeof parsed.summary === "string"
        ? parsed.summary
        : typeof doneParams.summary === "string"
          ? doneParams.summary
          : undefined;
    const success =
      typeof parsed.success === "boolean"
        ? parsed.success
        : typeof doneParams.success === "boolean"
          ? doneParams.success
          : undefined;
    return {
      actions,
      done,
      summary,
      success,
      thought: typeof parsed.thought === "string" ? parsed.thought : undefined,
      nextGoal: typeof parsed.nextGoal === "string" ? parsed.nextGoal : undefined,
      memory: typeof parsed.memory === "string" ? parsed.memory : undefined,
    };
  }

  if (typeof parsed.name !== "string") {
    throw new Error("Decision response missing action name");
  }

  const name = parsed.name;
  const params = (parsed.params ?? {}) as Record<string, unknown>;
  const done = name === "done";
  const thought = typeof parsed.thought === "string" ? parsed.thought : undefined;
  const nextGoal = typeof parsed.nextGoal === "string" ? parsed.nextGoal : undefined;
  const memory = typeof parsed.memory === "string" ? parsed.memory : undefined;

  return {
    actions: [{ name, params }],
    done,
    summary: done ? String(params.summary ?? "") : undefined,
    success: done ? Boolean(params.success) : undefined,
    ...(thought ? { thought } : {}),
    ...(nextGoal ? { nextGoal } : {}),
    ...(memory ? { memory } : {}),
  };
}

function stripCodeFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  return cleaned.trim();
}

function extractFirstJsonObject(text: string): string | null {
  const source = stripCodeFences(text);
  const start = source.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const ch = source[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}
