import type { CDPClient } from "../../cdp/client";

export type CaptchaResult = "success" | "failed" | "unknown";

export interface CaptchaWaitResult {
  vendor: string;
  url: string;
  result: CaptchaResult;
  durationMs: number;
}

interface CaptchaStartedEvent {
  vendor?: string;
  url?: string;
}

interface CaptchaFinishedEvent {
  vendor?: string;
  url?: string;
  success?: boolean;
  durationMs?: number;
}

export class CaptchaWatchdog {
  private captchaSolving = false;
  private captchaInfo: { vendor: string; url: string } = { vendor: "unknown", url: "" };
  private captchaResult: CaptchaResult = "unknown";
  private captchaDurationMs = 0;
  private waiters = new Set<() => void>();
  private unsubscribers: Array<() => void> = [];

  attach(client: CDPClient): void {
    this.unsubscribers.push(
      client.on("BrowserUse.captchaSolverStarted", (params) => {
        const event = (params ?? {}) as CaptchaStartedEvent;
        this.captchaSolving = true;
        this.captchaInfo = {
          vendor: event.vendor ?? "unknown",
          url: event.url ?? "",
        };
        this.captchaResult = "unknown";
        this.captchaDurationMs = 0;
      }),
    );

    this.unsubscribers.push(
      client.on("BrowserUse.captchaSolverFinished", (params) => {
        const event = (params ?? {}) as CaptchaFinishedEvent;
        this.captchaSolving = false;
        this.captchaInfo = {
          vendor: event.vendor ?? this.captchaInfo.vendor,
          url: event.url ?? this.captchaInfo.url,
        };
        this.captchaResult =
          event.success === true ? "success" : event.success === false ? "failed" : "unknown";
        this.captchaDurationMs = event.durationMs ?? 0;
        for (const wake of this.waiters) wake();
        this.waiters.clear();
      }),
    );

    this.unsubscribers.push(
      client.onClose(() => {
        this.captchaSolving = false;
        for (const wake of this.waiters) wake();
        this.waiters.clear();
      }),
    );
  }

  detach(): void {
    for (const unsub of this.unsubscribers) {
      unsub();
    }
    this.unsubscribers = [];
    this.captchaSolving = false;
    for (const wake of this.waiters) wake();
    this.waiters.clear();
  }

  async waitIfSolving(timeoutMs = 30_000): Promise<CaptchaWaitResult | null> {
    if (!this.captchaSolving) {
      return null;
    }

    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.waiters.delete(onDone);
        this.captchaSolving = false;
        resolve();
      }, timeoutMs);

      const onDone = () => {
        clearTimeout(timer);
        resolve();
      };

      this.waiters.add(onDone);
    });

    return {
      vendor: this.captchaInfo.vendor,
      url: this.captchaInfo.url,
      result: this.captchaResult,
      durationMs: this.captchaDurationMs,
    };
  }
}
