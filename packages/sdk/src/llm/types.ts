/** Token counts reported by the model SDK. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  /**
   * Cached prompt tokens reported by the provider. Anthropic surfaces this as
   * `cache_read_input_tokens`; OpenAI as `input_tokens_details.cached_tokens`.
   * When non-zero on step 2+ it indicates the ephemeral-cache prefix hit.
   */
  cachedInputTokens?: number;
  /**
   * Tokens that were written into the provider cache on this request
   * (Anthropic's `cache_creation_input_tokens`). Typically non-zero only on
   * the first request that primes the cache.
   */
  cacheCreationTokens?: number;
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
