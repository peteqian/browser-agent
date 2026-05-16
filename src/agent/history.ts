export type HistoryEntry = { action: string; result: string };

/**
 * Head+tail compaction. Keeps the first `head` entries (usually the initial
 * navigation context) plus the last `tail` entries (the recent operating
 * window), with a synthetic marker entry filling the middle so the model can
 * see *how much* was skipped without bloating the prompt.
 */
export function compactHistory(
  history: HistoryEntry[],
  head: number,
  tail: number,
): HistoryEntry[] {
  const safeHead = Math.max(0, Math.floor(head));
  const safeTail = Math.max(1, Math.floor(tail));
  if (history.length <= safeHead + safeTail) return history.slice();
  const headSlice = history.slice(0, safeHead);
  const tailSlice = history.slice(-safeTail);
  const omitted = history.length - safeHead - safeTail;
  return [
    ...headSlice,
    { action: "...", result: `(${omitted} earlier step${omitted === 1 ? "" : "s"} omitted)` },
    ...tailSlice,
  ];
}
