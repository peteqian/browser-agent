import type { BrowserStateSummary } from "../../browser/state";
import { buildLoopFingerprint, isRepeatingLoop } from "../features/loop-detection";

/**
 * Per-step loop-detection orchestration: combines the page-state+action
 * fingerprint with the canonicalised action-call signature, decides whether to
 * stop, nudge, reset the nudge budget, or do nothing. The pure pattern
 * detectors it builds on (same-name run, alternating pair) live in
 * `../features/loop-detection`.
 */
export type LoopDetectionOutcome =
  | { kind: "stop" }
  | { kind: "nudge"; notice: string; nudgesUsed: number }
  | { kind: "reset" }
  | { kind: "noop" };

export function handleLoopDetection(input: {
  loopFingerprints: string[];
  browserState: BrowserStateSummary;
  actionResults: Array<{ ok: boolean; message: string }>;
  recentActionCalls: readonly string[];
  window: number;
  mode: "nudge" | "strict";
  nudgesUsed: number;
  nudgeBudget: number;
}): LoopDetectionOutcome {
  const fingerprint = buildLoopFingerprint(input.browserState, input.actionResults);
  // Additionally fold in the canonicalised action-name signature of the
  // latest step so that calls with identical params other than `index`
  // do not bypass the legacy fingerprint just because the message text
  // includes the index number.
  const callSig = input.recentActionCalls.at(-1) ?? "";
  const composite = `${fingerprint}|${callSig}`;
  input.loopFingerprints.push(composite);
  if (input.loopFingerprints.length > input.window) input.loopFingerprints.shift();

  if (isRepeatingLoop(input.loopFingerprints, input.window)) {
    if (input.mode === "strict" || input.nudgesUsed >= input.nudgeBudget) {
      return { kind: "stop" };
    }
    const nudgesUsed = input.nudgesUsed + 1;
    const notice = `Stagnation notice: the last ${input.window} steps repeated the same action and produced the same page state. Try a different approach — change parameters, target a different element, or call \`done\` if you cannot make progress. (nudge ${nudgesUsed}/${input.nudgeBudget})`;
    return { kind: "nudge", notice, nudgesUsed };
  }

  return input.nudgesUsed > 0 ? { kind: "reset" } : { kind: "noop" };
}

const ALTERNATIVES_BY_NAME: Record<string, string> = {
  eval: "screenshot (with annotate=true), find_elements, find_by_role, find_by_text, or extract_content",
  find_elements: "find_by_role, find_by_text, find_by_testid, snapshot refs, or extract_content",
  search_page: "snapshot refs, find_by_text, or extract_content with a tighter query",
  scroll: "click_by on a 'Next' / 'Load more' control, or extract_content with startFromChar",
};

export function buildSameNameNudge(run: { name: string; count: number }): string {
  const alt = ALTERNATIVES_BY_NAME[run.name] ?? "a different action";
  return (
    `Stagnation notice: \`${run.name}\` has been called ${run.count} times in a row. ` +
    `The variations aren't producing new information. Switch tactic — try ${alt}. ` +
    `If you have what you need, call \`done\` now.`
  );
}

export function buildAlternatingNudge(pair: { a: string; b: string; pairs: number }): string {
  return (
    `Stagnation notice: you have alternated \`${pair.a}\` and \`${pair.b}\` for ${pair.pairs} cycles. ` +
    `This is the same loop pattern. Either commit the value you've already extracted to memory and emit \`done\`, ` +
    `or switch strategy entirely.`
  );
}
