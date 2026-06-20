import type { AgentInput, AgentOutput } from "../decide/contracts";

export async function withRejectingTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * Wraps a `decide` call in a timeout that aborts the underlying request via
 * AbortSignal so the SDK actually cancels its HTTP work instead of leaking a
 * background promise. Honors a parent signal too — if the run is aborted, the
 * decide call is also aborted.
 */
export async function withDecideTimeout(
  decide: (input: AgentInput, signal: AbortSignal) => Promise<AgentOutput>,
  input: AgentInput,
  timeoutMs: number,
  message: string,
  parentSignal?: AbortSignal,
): Promise<AgentOutput> {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parentSignal?.reason);
  if (parentSignal) {
    if (parentSignal.aborted) controller.abort(parentSignal.reason);
    else parentSignal.addEventListener("abort", onParentAbort, { once: true });
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<AgentOutput>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([decide(input, controller.signal), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (parentSignal) parentSignal.removeEventListener("abort", onParentAbort);
  }
}

/**
 * Returns a signal that aborts when any input signal aborts, plus a cleanup
 * callback for listener removal. Avoids allocating a controller when there are
 * zero or one input signals.
 */
export function combineSignals(...signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal | undefined;
  cleanup: () => void;
} {
  const filtered = signals.filter((s): s is AbortSignal => Boolean(s));
  if (filtered.length === 0) return { signal: undefined, cleanup: () => {} };
  if (filtered.length === 1) return { signal: filtered[0], cleanup: () => {} };

  const alreadyAborted = filtered.find((s) => s.aborted);
  if (alreadyAborted) {
    const controller = new AbortController();
    controller.abort(alreadyAborted.reason);
    return { signal: controller.signal, cleanup: () => {} };
  }

  const controller = new AbortController();
  const cleanups: Array<() => void> = [];
  for (const signal of filtered) {
    const onAbort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    cleanups.push(() => signal.removeEventListener("abort", onAbort));
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      for (const cleanup of cleanups) cleanup();
    },
  };
}
