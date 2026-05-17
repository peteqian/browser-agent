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

Return exactly one JSON object (no markdown) with this shape:
{"name":"<action_name>","params":{...}}

You may add optional top-level fields: "thought" (one-line reasoning), "nextGoal" (next step you intend), "memory" (compact note carried forward). Example:
{"thought":"page loaded","nextGoal":"extract H1","name":"extract_content","params":{"query":"H1"}}

When you finish the task, call the "done" action with the answer in params.summary as plain text (and params.success=true). The summary string is the only thing the caller sees — be specific. Example:
{"name":"done","params":{"success":true,"summary":"The H1 reads: Example Domain"}}

Do not return any text outside JSON.`;
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
  if (!parsed || typeof parsed.name !== "string") {
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
