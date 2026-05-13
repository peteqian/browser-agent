import type { Action } from "../actions/types";
import type { ActionDefinition, ActionRegistry, RegisteredAction } from "../actions/registry";
import type { LaunchOptions } from "../cdp/launch";
import type { BrowserSession, Page } from "../browser/session";
import type { BrowserEvent } from "../browser/events";
import type { BrowserStateSummary } from "../browser/state";
import type { DomBudgetOptions } from "../dom/cdp-snapshot";
import type { RetryOptions } from "./retry";
import type { z } from "zod";

/**
 * Public contract types shared with browser-agent consumers.
 *
 * Downstream packages should import these shapes from `@browser-agent/core`
 * instead of redefining them locally so the package boundary can move without
 * breaking the integration contract.
 */

/** Snapshot of what the deciding model sees for one loop iteration. */
export interface DecisionInput {
  task: string;
  step: number;
  maxSteps: number;
  browserState?: BrowserStateSummary;
  observation: string;
  tabs: string[];
  activeTab: string;
  history: Array<{ action: string; result: string }>;
  actionCatalog?: string;
}

/** Raw model-proposed action before schema parsing and execution. */
export interface RawAction {
  name: string;
  params: unknown;
}

/** Structured model output consumed by `runAgent`. */
export interface Decision {
  thought?: string;
  memory?: string;
  evaluationPreviousGoal?: string;
  nextGoal?: string;
  plan?: PlanItem[];
  actions: RawAction[];
  done: boolean;
  summary?: string;
  success?: boolean;
  /**
   * Optional per-decision telemetry filled by adapters (token counts, latency,
   * cost). Surfaces on `decision` events so consumers can track spend.
   */
  telemetry?: import("../llm/types").DecisionTelemetry;
}

export interface PlanItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "done" | "blocked";
}

export type AgentAction = Action | RegisteredAction;

/** Durable execution record for one action step. */
export interface StepInfo {
  step: number;
  url: string;
  action: AgentAction;
  result: { ok: boolean; message: string };
}

/**
 * Discriminated union of events emitted during an agent run. Subscribe via
 * `AgentOptions.onEvent` to drive UIs, telemetry, or audit trails.
 *
 * Event order per step: one `decision` (after the model returns), one
 * `action` per executed action, then `terminal` once when the loop exits.
 */
export type AgentEvent<TData = unknown> =
  | { type: "browser_state"; step: number; state: BrowserStateSummary }
  | { type: "screenshot"; step: number; screenshot: NonNullable<BrowserStateSummary["screenshot"]> }
  | { type: "action_start"; step: number; action: AgentAction }
  | { type: "planning"; step: number; plan?: PlanItem[]; memory?: string; nextGoal?: string }
  | { type: "browser_event"; event: BrowserEvent }
  | { type: "decision"; step: number; decision: Decision }
  | {
      type: "action";
      step: number;
      url: string;
      action: AgentAction;
      result: { ok: boolean; message: string };
    }
  | { type: "transport_resolved"; resolution: TransportResolution }
  | { type: "terminal"; result: AgentResult<TData> };

/** Logical environment the agent is running in. Drives transport priority. */
export type EnvId = "local" | "cloud";

/** Transport mechanism used to reach the model. */
export type TransportId = "sdk-agent" | "sdk-api" | "cli";

/**
 * Result of resolving a transport for a given provider. Surfaced via the
 * `transport_resolved` event and to optional `onResolve` callbacks so
 * consumers can see when a fallback occurred.
 */
export interface TransportResolution {
  provider: string;
  env: EnvId;
  transport: TransportId;
  /** Set when the resolver fell back from a higher-priority transport. */
  fallbackFrom?: TransportId;
  /** Reason the higher-priority transport was unavailable. */
  fallbackReason?: string;
  durationMs: number;
}

/** Callback for the structured event stream. May be async. */
export type OnEventCallback<TData = unknown> = (event: AgentEvent<TData>) => void | Promise<void>;

/**
 * Why the agent loop terminated. Consumers should branch on this rather than
 * pattern-matching `summary`.
 */
export type TerminalReason =
  | "completed"
  | "failed"
  | "max_steps"
  | "max_failures"
  | "loop_detected"
  | "aborted"
  | "stopped"
  | "step_timeout"
  | "decision_timeout"
  | "schema_violation"
  | "decide_error";

/** Terminal summary returned by the browser-agent loop. */
export interface AgentResult<TData = unknown> {
  /** True when `reason === "completed"`. Kept for backwards compatibility. */
  success: boolean;
  /** Structured termination reason. Branch on this in consumer code. */
  reason: TerminalReason;
  /** Human-readable summary; may be empty for purely structured callers. */
  summary: string;
  /** Validated terminal data (when `outputSchema` set) or `done(data=...)` payload. */
  data: TData | null;
  /** Number of steps the loop executed before terminating. */
  steps: number;
}

/**
 * Decide function signature.
 *
 * The loop passes an `AbortSignal` that fires when the per-decision timeout
 * elapses or when the run is aborted/stopped. Adapters should forward the
 * signal to their underlying SDK call (HTTP cancel, subprocess kill, etc.) so
 * timed-out work actually stops instead of running orphaned.
 */
export type DecideFn = (input: DecisionInput, signal: AbortSignal) => Promise<Decision>;

/** Runtime control surface for externally managed agent runs. */
export interface AgentControl {
  readonly signal: AbortSignal;
  readonly isPaused: boolean;
  readonly stopReason?: string;
  pause: () => void;
  resume: () => void;
  stop: (reason?: string) => void;
  waitIfPaused: () => Promise<void>;
}

/**
 * Input contract for running the browser-agent loop against either owned or
 * caller-supplied browser/page handles.
 */
export interface AgentOptions<TData = unknown> {
  /** Natural-language task the agent should accomplish. Forwarded to `decide`. */
  task: string;
  /** Decision function — usually `createDecide({...})` or a built-in adapter. */
  decide: DecideFn;
  /** Capture screenshots and pass them to providers that support multimodal input. Default: "auto". */
  vision?: boolean | "auto";
  /** Include planning/memory fields in prompts and events. Default: true. */
  planning?: boolean;
  /** Override or extend the action catalog used by the model and executor. */
  actions?: ActionRegistry | ActionDefinition[];
  /**
   * Zod schema for the terminal `done(data=...)` payload. When set, the loop
   * validates the model's terminal data; failure resolves to `reason:
   * "schema_violation"` with `data: null`.
   */
  outputSchema?: z.ZodType<TData>;
  /** Hard cap on loop iterations. Default: 40. */
  maxSteps?: number;
  /** Timeout for per-step page-context preparation (DOM serialize, pending requests). Default: 180000. */
  stepTimeoutMs?: number;
  /** Timeout for executing a single action. Default: 30000. */
  actionTimeoutMs?: number;
  /** Timeout for one model decision call. Aborts the SDK request. Default: 120000. */
  decisionTimeoutMs?: number;
  /**
   * Retry policy for `decide()` calls. Default: 3 attempts with exponential
   * backoff for 429/5xx/network errors. Pass `{ maxAttempts: 1 }` to disable.
   */
  decideRetry?: RetryOptions;
  /**
   * Maximum consecutive failed steps before the loop terminates. Values < 1
   * are coerced to the default (5); there is no "disabled" mode — pass a very
   * large number if you need to effectively disable this limit.
   */
  maxFailures?: number;
  /**
   * After hitting `maxFailures`, ask the model one more time for a clean done
   * action. Useful for surfacing structured failure summaries. Default: true.
   */
  finalResponseAfterFailure?: boolean;
  /** Enable identical-fingerprint loop detection. Default: true. */
  loopDetectionEnabled?: boolean;
  /** Number of identical consecutive fingerprints to treat as a loop. Default: 4. */
  loopDetectionWindow?: number;
  /**
   * Cooperative control surface (pause/resume/stop). When set, the loop checks
   * `control.signal` and `control.waitIfPaused()` in addition to `signal`.
   * Both are honored; either aborting terminates the run. Use `control` for
   * interactive UIs and `signal` for plain cancellation.
   */
  control?: AgentControl;
  signal?: AbortSignal;
  /** Browser launch options when the loop owns the session (no `page`/`session` given). */
  launch?: LaunchOptions;
  /** URL to navigate to before the first decision. */
  startUrl?: string;
  /** Caller-supplied page. When set, loop does not own browser lifecycle. */
  page?: Page;
  /** Caller-supplied session. When set, loop does not own browser lifecycle. */
  session?: BrowserSession;
  /**
   * Legacy per-action callback. Receives one `StepInfo` per executed action.
   * Prefer `onEvent` for new code — it carries decision and terminal events
   * too. Both callbacks fire when set.
   */
  onStep?: (info: StepInfo) => void;
  /**
   * Structured event stream. Receives `decision`, `action`, and `terminal`
   * events in order. Async callbacks are awaited before the loop continues.
   */
  onEvent?: OnEventCallback<TData>;
  /**
   * Transport resolution produced by `resolveTransport` / `createDecide`.
   * When set, the loop emits a `transport_resolved` event before the first
   * step so consumers see which transport / fallback was selected.
   */
  transportResolution?: TransportResolution;
  /** Caps on per-step DOM snapshot capture and prompt formatting. */
  domBudgets?: DomBudgetOptions;
}
