/**
 * Retry helper used to wrap LLM `decide()` calls in the agent loop.
 *
 * Why retry decide() at all? Provider rate limits (HTTP 429) and transient
 * network blips would otherwise count toward `consecutiveFailures` and abort
 * runs that would have succeeded with a 2-second delay.
 *
 * Default policy: 3 attempts, exponential backoff with jitter, only on
 * transient errors. Users can override via `RetryOptions` on Agent.
 */

export interface RetryOptions {
  /** Total attempts including the first try. Default 3. Set 1 to disable. */
  maxAttempts?: number;
  /** Initial backoff in ms. Default 500. */
  initialDelayMs?: number;
  /** Cap on a single delay. Default 10000. */
  maxDelayMs?: number;
  /**
   * Predicate deciding whether an error is worth retrying. Default: 429
   * status codes and known transient network errors. Return true to retry.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  /** Optional notifier when a retry is scheduled. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export const DEFAULT_RETRY: Required<
  Pick<RetryOptions, "maxAttempts" | "initialDelayMs" | "maxDelayMs">
> = {
  maxAttempts: 3,
  initialDelayMs: 500,
  maxDelayMs: 10_000,
};

/**
 * Run `fn` with retry. Forwards `signal` so an aborted parent stops the
 * retry chain immediately rather than waiting for the next backoff window.
 */
export async function withRetry<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  options: RetryOptions = {},
  signal?: AbortSignal,
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_RETRY.maxAttempts;
  const initialDelay = options.initialDelayMs ?? DEFAULT_RETRY.initialDelayMs;
  const maxDelay = options.maxDelayMs ?? DEFAULT_RETRY.maxDelayMs;
  const shouldRetry = options.shouldRetry ?? defaultShouldRetry;

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (signal?.aborted) {
      throw signal.reason ?? new Error("retry aborted");
    }
    try {
      return await fn(signal);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts) break;
      if (!shouldRetry(error, attempt)) break;

      const delay = computeDelay(attempt, initialDelay, maxDelay);
      options.onRetry?.({ attempt, delayMs: delay, error });
      await sleep(delay, signal);
    }
  }
  throw lastError;
}

function computeDelay(attempt: number, initial: number, max: number): number {
  const exp = initial * 2 ** (attempt - 1);
  const capped = Math.min(exp, max);
  // Full jitter — random delay in [0, capped]. Avoids thundering herd.
  return Math.floor(Math.random() * capped);
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("sleep aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("sleep aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Default retry predicate. Retries on 429 rate-limit responses and known
 * transient network errors. Does NOT retry on 4xx (other than 429) or on
 * provider-side validation errors — those are caller bugs.
 */
export function defaultShouldRetry(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const e = error as { status?: unknown; code?: unknown; name?: unknown; message?: unknown };

  if (e.status === 429) return true;
  if (typeof e.status === "number" && e.status >= 500 && e.status < 600) return true;

  if (typeof e.code === "string") {
    if (
      e.code === "ECONNRESET" ||
      e.code === "ETIMEDOUT" ||
      e.code === "ECONNREFUSED" ||
      e.code === "EPIPE" ||
      e.code === "EAI_AGAIN"
    ) {
      return true;
    }
  }

  if (e.name === "AbortError") return false;

  if (typeof e.message === "string") {
    const m = e.message.toLowerCase();
    if (m.includes("rate limit") || m.includes("429")) return true;
    if (m.includes("socket hang up") || m.includes("network")) return true;
  }

  return false;
}
