import { setTimeout as delay } from "node:timers/promises";

import { launchBrowserFromProfile } from "../cdp/launch";
import type { BrowserSession } from "./session";

export async function reconnectIfNeeded(session: BrowserSession): Promise<void> {
  if (session.intentionalStop || session.reconnecting) return;

  if (!session.profile.reconnectOnDisconnect) {
    void session.eventBus.emit({
      type: "browser_event",
      name: "cdp_reconnect_failed",
      data: {
        reason: "reconnect_disabled",
        maxAttempts: session.profile.reconnectMaxAttempts,
      },
    });
    return;
  }

  session.reconnecting = true;
  session.setState("reconnecting");
  void session.eventBus.emit({
    type: "browser_event",
    name: "cdp_reconnect_started",
    data: {
      maxAttempts: session.profile.reconnectMaxAttempts,
      managedLocal: session.profile.isManagedLocal(),
    },
  });

  try {
    let attempt = 0;
    while (attempt < session.profile.reconnectMaxAttempts && !session.intentionalStop) {
      attempt += 1;
      void session.eventBus.emit({
        type: "browser_event",
        name: "cdp_reconnect_attempt",
        data: {
          attempt,
          maxAttempts: session.profile.reconnectMaxAttempts,
          managedLocal: session.profile.isManagedLocal(),
        },
      });

      if (session.profile.isManagedLocal()) {
        const browserStillAlive = session.browser?.process.exitCode === null;
        if (!browserStillAlive) {
          session.browser = await launchBrowserFromProfile(session.profile);
        }
      }

      try {
        await session.connectToEndpoint(session.getSocketUrl());
        session.setState("connected");
        void session.eventBus.emit({
          type: "browser_event",
          name: "cdp_reconnected",
          data: { attempt, maxAttempts: session.profile.reconnectMaxAttempts },
        });
        return;
      } catch (error) {
        const backoff = Math.min(
          session.profile.reconnectMaxDelayMs,
          session.profile.reconnectBaseDelayMs * 2 ** (attempt - 1),
        );
        void session.eventBus.emit({
          type: "browser_event",
          name: "cdp_reconnect_attempt_failed",
          data: {
            attempt,
            maxAttempts: session.profile.reconnectMaxAttempts,
            backoffMs: backoff,
            error: error instanceof Error ? error.message : String(error),
          },
        });
        await delay(backoff);
      }
    }

    session.setState("disconnected");
    void session.eventBus.emit({
      type: "browser_event",
      name: "cdp_reconnect_failed",
      data: {
        reason: "max_attempts_exhausted",
        maxAttempts: session.profile.reconnectMaxAttempts,
      },
    });
    if (session.browser) {
      await session.browser.close().catch(() => {});
      session.browser = null;
    }
  } finally {
    session.reconnecting = false;
  }
}
