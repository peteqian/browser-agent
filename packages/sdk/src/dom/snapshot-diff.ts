import type { ElementInfo, PageSnapshot } from "./types";

export interface SnapshotDiffChange {
  prev: ElementInfo;
  next: ElementInfo;
}

export interface SnapshotDiff {
  added: ElementInfo[];
  removed: ElementInfo[];
  changed: SnapshotDiffChange[];
  unchanged: number;
}

function fallbackKey(el: ElementInfo): string {
  return `${el.framePath}|${el.axRole ?? ""}|${el.axName ?? ""}`;
}

/**
 * Diff two snapshots element-by-element.
 *
 * Matching strategy:
 *   1. Pair elements with identical `stableId` (treated as unique within a
 *      snapshot — duplicates fall through to step 2 for the extras).
 *   2. For anything left over, pair by the `(framePath, axRole, axName)`
 *      tuple. Ambiguous tuples consume their candidates in order.
 *
 * Anything matched but with a different `axName` or `text` is reported as
 * `changed`. Everything else is `added`, `removed`, or counted as
 * `unchanged`.
 */
export function diffSnapshots(prev: PageSnapshot, next: PageSnapshot): SnapshotDiff {
  const added: ElementInfo[] = [];
  const removed: ElementInfo[] = [];
  const changed: SnapshotDiffChange[] = [];
  let unchanged = 0;

  const consumedPrev = new Set<number>();
  const consumedNext = new Set<number>();

  // Step 1: stableId matching (skip empty ids; only first occurrence wins).
  const prevById = new Map<string, number>();
  for (let i = 0; i < prev.elements.length; i += 1) {
    const el = prev.elements[i] as ElementInfo;
    if (!el.stableId) continue;
    if (!prevById.has(el.stableId)) prevById.set(el.stableId, i);
  }

  for (let j = 0; j < next.elements.length; j += 1) {
    const n = next.elements[j] as ElementInfo;
    if (!n.stableId) continue;
    const pi = prevById.get(n.stableId);
    if (pi === undefined) continue;
    if (consumedPrev.has(pi)) continue;
    const p = prev.elements[pi] as ElementInfo;
    classifyPair(p, n, changed, () => {
      unchanged += 1;
    });
    consumedPrev.add(pi);
    consumedNext.add(j);
  }

  // Step 2: tuple fallback for unmatched.
  const prevByTuple = new Map<string, number[]>();
  for (let i = 0; i < prev.elements.length; i += 1) {
    if (consumedPrev.has(i)) continue;
    const el = prev.elements[i] as ElementInfo;
    const key = fallbackKey(el);
    const bucket = prevByTuple.get(key);
    if (bucket) bucket.push(i);
    else prevByTuple.set(key, [i]);
  }

  for (let j = 0; j < next.elements.length; j += 1) {
    if (consumedNext.has(j)) continue;
    const n = next.elements[j] as ElementInfo;
    const bucket = prevByTuple.get(fallbackKey(n));
    if (!bucket || bucket.length === 0) continue;
    const pi = bucket.shift() as number;
    const p = prev.elements[pi] as ElementInfo;
    classifyPair(p, n, changed, () => {
      unchanged += 1;
    });
    consumedPrev.add(pi);
    consumedNext.add(j);
  }

  for (let j = 0; j < next.elements.length; j += 1) {
    if (!consumedNext.has(j)) added.push(next.elements[j] as ElementInfo);
  }
  for (let i = 0; i < prev.elements.length; i += 1) {
    if (!consumedPrev.has(i)) removed.push(prev.elements[i] as ElementInfo);
  }

  return { added, removed, changed, unchanged };
}

function classifyPair(
  prev: ElementInfo,
  next: ElementInfo,
  changed: SnapshotDiffChange[],
  bumpUnchanged: () => void,
): void {
  const nameChanged = (prev.axName ?? "") !== (next.axName ?? "");
  const textChanged = (prev.text ?? "") !== (next.text ?? "");
  if (nameChanged || textChanged) changed.push({ prev, next });
  else bumpUnchanged();
}
