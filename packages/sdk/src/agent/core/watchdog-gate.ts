import type { BrowserSession } from "../../browser/session/session";
import { ChallengeWatchdog, challengeObservationNote } from "../../browser/watchdogs/challenge";
import { LoginWallWatchdog, loginWallObservationNote } from "../../browser/watchdogs/login-wall";
import type { SessionRunner } from "../../runtime/session-runner";
import type { AgentOptions } from "../decide/contracts";
import { emitEvent } from "../observe/emit";

/**
 * Runs the bot-protection and login-wall watchdogs before a step's snapshot so
 * a gated page is cleared or reported before we spend a snapshot + decision on
 * it. Emits structured events plus browser-event signals, and returns the
 * observation notes (null when no encounter) for the model to route around.
 * Detection failures (fake test pages, mid-navigation evaluate errors) are
 * non-fatal — the watchdog `.check()` rejections are swallowed.
 */
export async function runWatchdogs<TData>(input: {
  challengeWatchdog: ChallengeWatchdog | null;
  loginWallWatchdog: LoginWallWatchdog | null;
  runner: SessionRunner;
  session: BrowserSession | undefined;
  options: AgentOptions<TData>;
  step: number;
}): Promise<{ challengeNote: string | null; loginWallNote: string | null }> {
  const { challengeWatchdog, loginWallWatchdog, runner, session, options, step } = input;

  let challengeNote: string | null = null;
  if (challengeWatchdog) {
    const encounter = await challengeWatchdog.check(runner.page).catch(() => null);
    if (encounter) {
      await emitEvent(options, { type: "challenge", step, encounter });
      await session?.eventBus?.emit({
        type: "browser_event",
        name: encounter.resolved ? "challenge_resolved" : "challenge_unresolved",
        data: encounter,
      });
      if (!encounter.resolved) challengeNote = challengeObservationNote(encounter);
    }
  }

  // Login-wall detection mirrors the challenge path: emit a structured event so
  // callers can pause for a human, and note it in the observation.
  let loginWallNote: string | null = null;
  if (loginWallWatchdog) {
    const encounter = await loginWallWatchdog.check(runner.page).catch(() => null);
    if (encounter) {
      await emitEvent(options, { type: "login_wall", step, encounter });
      await session?.eventBus?.emit({
        type: "browser_event",
        name: "login_wall",
        data: encounter,
      });
      loginWallNote = loginWallObservationNote(encounter);
    }
  }

  return { challengeNote, loginWallNote };
}
