import type { TokenUsage } from "./decision/types";

/**
 * Per-million-token pricing used to turn TokenUsage into dollars.
 * Cache reads bill at ~0.1x input, cache writes at 1.25x input (5-minute TTL)
 * unless a model overrides them.
 */
export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  /** Defaults to inputPerMTok * 0.1. */
  cacheReadPerMTok?: number;
  /** Defaults to inputPerMTok * 1.25. */
  cacheWritePerMTok?: number;
}

/**
 * Built-in price table (USD per million tokens). Cached from provider price
 * pages on 2026-06-04 — prices drift, so treat estimates as approximate and
 * pass a custom table (or per-model entry) when accuracy matters.
 */
export const DEFAULT_MODEL_PRICING: Record<string, ModelPricing> = {
  "claude-fable-5": { inputPerMTok: 10, outputPerMTok: 50 },
  "claude-opus-4-8": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-7": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-opus-4-6": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-4-6": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-sonnet-4-5": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4-5": { inputPerMTok: 1, outputPerMTok: 5 },
  "gpt-5.2": { inputPerMTok: 1.25, outputPerMTok: 10 },
  "gpt-5.2-mini": { inputPerMTok: 0.25, outputPerMTok: 2 },
};

/**
 * Look up pricing for a model id, tolerating provider prefixes and date
 * suffixes (e.g. "anthropic/claude-sonnet-4-6", "claude-haiku-4-5-20251001").
 */
export function resolveModelPricing(
  model: string | undefined,
  table: Record<string, ModelPricing> = DEFAULT_MODEL_PRICING,
): ModelPricing | null {
  if (!model) return null;
  const normalized = model.toLowerCase().replace(/^.*\//, "");
  if (table[normalized]) return table[normalized] ?? null;
  for (const [key, pricing] of Object.entries(table)) {
    if (normalized.startsWith(key)) return pricing;
  }
  return null;
}

/**
 * Cost in USD for one usage record, or null when the model has no pricing
 * entry. `usage.inputTokens` is treated as the uncached portion (providers
 * report cached tokens separately).
 */
export function estimateCostUsd(
  usage: TokenUsage | undefined,
  model: string | undefined,
  table?: Record<string, ModelPricing>,
): number | null {
  if (!usage) return null;
  const pricing = resolveModelPricing(model, table);
  if (!pricing) return null;
  const cacheRead = pricing.cacheReadPerMTok ?? pricing.inputPerMTok * 0.1;
  const cacheWrite = pricing.cacheWritePerMTok ?? pricing.inputPerMTok * 1.25;
  const cost =
    (usage.inputTokens / 1_000_000) * pricing.inputPerMTok +
    (usage.outputTokens / 1_000_000) * pricing.outputPerMTok +
    ((usage.cachedInputTokens ?? 0) / 1_000_000) * cacheRead +
    ((usage.cacheCreationTokens ?? 0) / 1_000_000) * cacheWrite;
  return cost;
}
