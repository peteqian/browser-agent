import type { AgentOutput } from "../agent/contracts";

/**
 * JSON Schema describing the AgentOutput shape for structured-output APIs
 * (OpenAI `response_format: json_schema`, Anthropic `output_config`).
 *
 * Kept relaxed (no strict mode) because `params` has a dynamic shape that
 * depends on the action name.
 */
export const decisionJsonSchema = {
  type: "object",
  properties: {
    thought: { type: "string" },
    memory: { type: "string" },
    evaluationPreviousGoal: { type: "string" },
    nextGoal: { type: "string" },
    plan: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          text: { type: "string" },
          status: { type: "string", enum: ["pending", "in_progress", "done", "blocked"] },
        },
        required: ["id", "text", "status"],
      },
    },
    actions: {
      type: "array",
      // Cap at 2 to encourage one-action-per-turn discipline. A 2nd action is
      // allowed only when the model is confident the next observation is
      // irrelevant for it (e.g. type into one field then immediately into
      // the next on an already-open form). Default is 1.
      maxItems: 2,
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          params: { type: "object" },
        },
        required: ["name", "params"],
      },
    },
    done: { type: "boolean" },
    success: { type: "boolean" },
    summary: { type: "string" },
  },
  required: ["actions", "done"],
} as const;

/**
 * Validate a parsed structured-output payload as an AgentOutput. Used by
 * adapters whose SDK returns already-parsed JSON (OpenAI, Anthropic).
 *
 * Throws with a specific message describing which field violated the
 * contract so adapter errors stay actionable.
 */
export function validateDecision(raw: unknown): AgentOutput {
  if (!raw || typeof raw !== "object") {
    throw new Error("Decision is not an object");
  }

  const d = raw as Record<string, unknown>;

  if (!Array.isArray(d.actions)) {
    throw new Error("Decision.actions must be an array");
  }

  const actions = d.actions.map((a: unknown) => {
    if (!a || typeof a !== "object") {
      throw new Error("Decision action is not an object");
    }
    const action = a as Record<string, unknown>;
    if (typeof action.name !== "string") {
      throw new Error("Decision action missing name");
    }
    return { name: action.name, params: action.params ?? {} };
  });

  // Trim to the 2-action cap. Anything beyond is dropped silently so the
  // model can't sneak past the discipline. Logged via the schema doc above.
  if (actions.length > 2) actions.length = 2;

  if (typeof d.done !== "boolean") {
    throw new Error("Decision.done must be a boolean");
  }

  return {
    thought: typeof d.thought === "string" ? d.thought : undefined,
    memory: typeof d.memory === "string" ? d.memory : undefined,
    evaluationPreviousGoal:
      typeof d.evaluationPreviousGoal === "string" ? d.evaluationPreviousGoal : undefined,
    nextGoal: typeof d.nextGoal === "string" ? d.nextGoal : undefined,
    plan: parsePlan(d.plan),
    actions,
    done: d.done,
    success: typeof d.success === "boolean" ? d.success : undefined,
    summary: typeof d.summary === "string" ? d.summary : undefined,
  };
}

function parsePlan(raw: unknown): ReturnType<typeof validateDecision>["plan"] {
  if (!Array.isArray(raw)) return undefined;
  const allowed = new Set(["pending", "in_progress", "done", "blocked"]);
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const value = item as Record<string, unknown>;
      if (
        typeof value.id !== "string" ||
        typeof value.text !== "string" ||
        typeof value.status !== "string" ||
        !allowed.has(value.status)
      ) {
        return null;
      }
      return {
        id: value.id,
        text: value.text,
        status: value.status as "pending" | "in_progress" | "done" | "blocked",
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}
