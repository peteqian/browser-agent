import type { BrowserStateSummary } from "../browser/state";

export function buildLoopFingerprint(
  browserState: BrowserStateSummary,
  actionResults: Array<{ ok: boolean; message: string }>,
): string {
  const actionPart = actionResults
    .map((result) => `${result.ok ? "ok" : "fail"}:${result.message}`)
    .join("|");
  return `${browserState.url}|${browserState.title}|${browserState.elements.length}|${actionPart}`;
}

export function isRepeatingLoop(fingerprints: string[], window: number): boolean {
  if (fingerprints.length < window) return false;
  const first = fingerprints[0];
  if (!first) return false;
  return fingerprints.every((fingerprint) => fingerprint === first);
}
