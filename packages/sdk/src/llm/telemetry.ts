import type { DecisionTelemetry, TokenUsage } from "./types";

/**
 * Build a DecisionTelemetry record from a startedAt timestamp, the model
 * identifier, and an already-extracted usage shape. Each adapter handles
 * the per-provider field-name mapping (prompt_tokens vs input_tokens etc.)
 * before calling this helper.
 */
export function buildTelemetry(
  startedAt: number,
  model: string,
  usage?: TokenUsage,
): DecisionTelemetry {
  return {
    latencyMs: Date.now() - startedAt,
    model,
    usage,
  };
}
