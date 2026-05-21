import type { BrowserStateSummary } from "../browser/state";

export function buildLoopFingerprint(
  browserState: BrowserStateSummary,
  actionResults: Array<{ ok: boolean; message: string }>,
  actionCalls?: readonly { name: string; params: unknown }[],
): string {
  const actionPart = actionResults
    .map((result) => `${result.ok ? "ok" : "fail"}:${result.message}`)
    .join("|");
  // Canonicalised call signatures stabilise the fingerprint when the same
  // action is repeated with cosmetic parameter drift (e.g. find_elements
  // with different `selector` strings on the same page). This is what
  // makes the find_elements×N dead-loop detectable.
  const callPart =
    actionCalls && actionCalls.length > 0
      ? actionCalls.map((c) => canonicaliseActionCall(c.name, c.params)).join("|")
      : "";
  return `${browserState.url}|${browserState.title}|${browserState.elements.length}|${actionPart}|${callPart}`;
}

export function isRepeatingLoop(fingerprints: string[], window: number): boolean {
  if (fingerprints.length < window) return false;
  const first = fingerprints[0];
  if (!first) return false;
  return fingerprints.every((fingerprint) => fingerprint === first);
}

/**
 * Canonical signature for an action call. Lowercased name + JSON of params
 * with stripped numeric indices (so `click {index:5}` and `click {index:9}`
 * collapse to the same fingerprint, but `click_by {role:"button"}` and
 * `click_by {role:"link"}` stay distinct). Used by the action-level
 * repeat-detector to catch find_elements / find_text dead-loops that
 * leave the page state unchanged.
 */
export function canonicaliseActionCall(name: string, params: unknown): string {
  const stripped = stripIndices(params);
  return `${name.toLowerCase()}(${stableStringify(stripped)})`;
}

function stripIndices(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripIndices);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "index" || k === "nth") continue;
      out[k] = stripIndices(v);
    }
    return out;
  }
  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).toSorted(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/**
 * Detects the "alternating two actions" rabbit-hole, e.g.
 * navigate, extract_content, navigate, extract_content … . Returns the
 * detected A/B pair when the last `2 * threshold` slots match the pattern
 * (a,b,a,b,...). Threshold is the number of A-B *pairs*; e.g. threshold=3
 * fires after 3 full alternations (6 actions).
 */
export function detectAlternatingPair(
  recent: readonly string[],
  threshold: number,
): { a: string; b: string; pairs: number } | null {
  if (recent.length < threshold * 2) return null;
  const tail = recent.slice(-threshold * 2);
  const a = tail[0];
  const b = tail[1];
  if (!a || !b || a === b) return null;
  for (let i = 0; i < tail.length; i++) {
    const expected = i % 2 === 0 ? a : b;
    if (tail[i] !== expected) return null;
  }
  return { a, b, pairs: threshold };
}

/**
 * Coarser detector keyed on action *name* only (e.g. "eval", "find_elements").
 * Catches the "same kind of action with cosmetically different params"
 * rabbit-hole the fingerprint detector misses. Returns the trailing run when
 * it reaches `threshold`, otherwise null.
 */
export function detectSameNameRun(
  recent: readonly string[],
  threshold: number,
): { name: string; count: number } | null {
  if (recent.length < threshold) return null;
  const last = recent.at(-1);
  if (!last) return null;
  let count = 0;
  for (let i = recent.length - 1; i >= 0; i--) {
    if (recent[i] !== last) break;
    count += 1;
  }
  return count >= threshold ? { name: last, count } : null;
}

/**
 * Returns the most recent action call that has appeared 2+ times in a row
 * inside `recent` (sliding window), or null. The hard-fail threshold is
 * handled separately in the loop driver.
 */
export function detectRepeatedAction(recent: readonly string[]): {
  fingerprint: string;
  count: number;
} | null {
  if (recent.length < 2) return null;
  let count = 1;
  let i = recent.length - 1;
  const last = recent[i];
  if (!last) return null;
  while (i > 0 && recent[i - 1] === last) {
    count += 1;
    i -= 1;
    if (count >= 4) break;
  }
  if (count >= 2) return { fingerprint: last, count };
  return null;
}
