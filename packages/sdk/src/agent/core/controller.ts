import type { AgentControl } from "../decide/contracts";

export class AgentController implements AgentControl {
  private abortController = new AbortController();
  private paused = false;
  private pauseWaiters = new Set<() => void>();
  private reason: string | undefined;

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  get stopReason(): string | undefined {
    return this.reason;
  }

  pause(): void {
    if (this.signal.aborted) return;
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    for (const resolve of this.pauseWaiters) {
      resolve();
    }
    this.pauseWaiters.clear();
  }

  stop(reason?: string): void {
    this.reason = reason;
    this.resume();
    this.abortController.abort(reason);
  }

  async waitIfPaused(): Promise<void> {
    if (!this.paused || this.signal.aborted) return;
    await new Promise<void>((resolve) => {
      this.pauseWaiters.add(resolve);
    });
  }
}
