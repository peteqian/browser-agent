export const DEFAULT_ACTION_TIMEOUT_MS = 30_000;
export const DEFAULT_DECISION_TIMEOUT_MS = 120_000;
export const DEFAULT_STEP_TIMEOUT_MS = 180_000;
export const DEFAULT_MAX_FAILURES = 5;
export const DEFAULT_LOOP_DETECTION_WINDOW = 4;
export const HISTORY_WINDOW = 8;
export const DEFAULT_HISTORY_HEAD = 2;

function coercePositive(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

export function coerceActionTimeoutMs(value: number | undefined): number {
  return coercePositive(value, DEFAULT_ACTION_TIMEOUT_MS);
}

export function coerceStepTimeoutMs(value: number | undefined): number {
  return coercePositive(value, DEFAULT_STEP_TIMEOUT_MS);
}

export function coerceDecisionTimeoutMs(value: number | undefined): number {
  return coercePositive(value, DEFAULT_DECISION_TIMEOUT_MS);
}

export function coerceMaxFailures(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    return DEFAULT_MAX_FAILURES;
  }
  return Math.floor(value);
}

export function coerceLoopDetectionWindow(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 2) {
    return DEFAULT_LOOP_DETECTION_WINDOW;
  }
  return Math.floor(value);
}
