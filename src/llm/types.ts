/** Token counts reported by the model SDK. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

/**
 * Per-decision telemetry. Adapters fill what their SDK exposes; consumers can
 * sum across `decision` events to enforce cost or token budgets.
 */
export interface DecisionTelemetry {
  usage?: TokenUsage;
  costUsd?: number;
  latencyMs?: number;
  /** Provider/model that produced this decision. Free-form. */
  model?: string;
}

/** Common options for built-in LLM adapters. */
export interface LLMAdapterOptions {
  /** API key for the provider. Falls back to env vars if omitted. */
  apiKey?: string;
  /** Base URL for the API (e.g. OpenRouter, local server). */
  baseURL?: string;
  /** Model identifier. */
  model: string;
  /** Sampling temperature (default: 0.2). */
  temperature?: number;
  /** Max completion tokens (default: 4096). */
  maxTokens?: number;
}
