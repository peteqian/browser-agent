import type { ActionResult } from "../actions/execute";
import type { RegisteredAction } from "../actions/registry";
import type { BrowserStateSummary } from "./state";

export type BrowserEvent =
  | { type: "browser_state"; state: BrowserStateSummary }
  | {
      type: "screenshot";
      targetId: string;
      screenshot: NonNullable<BrowserStateSummary["screenshot"]>;
    }
  | { type: "action_start"; step: number; action: RegisteredAction }
  | { type: "browser_event"; name: string; targetId?: string; data?: unknown }
  | { type: "browser_error"; message: string; targetId?: string; error?: unknown }
  | { type: "action_end"; step: number; action: RegisteredAction; result: ActionResult };

export type BrowserEventHandler = (event: BrowserEvent) => void | Promise<void>;

export class BrowserEventBus {
  private handlers = new Set<BrowserEventHandler>();
  readonly history: BrowserEvent[] = [];

  on(handler: BrowserEventHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async emit(event: BrowserEvent): Promise<void> {
    this.history.push(event);
    if (this.history.length > 200) {
      this.history.shift();
    }
    for (const handler of this.handlers) {
      await handler(event);
    }
  }
}
