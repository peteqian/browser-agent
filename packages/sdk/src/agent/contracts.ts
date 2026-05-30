import type { Action } from "../actions/types";
import type { ActionDefinition, ActionRegistry, RegisteredAction } from "../actions/registry";
import type { LaunchOptions } from "../cdp/launch";
import type { BrowserSession, Page } from "../browser/session";
import type { BrowserEvent } from "../browser/events";
import type { BrowserStateSummary } from "../browser/state";
import type { DomBudgetOptions } from "../dom/cdp-snapshot";
import type { RetryOptions } from "./retry";
import type { z } from "zod/v4";

/**
 * Public contract types shared with browser-agent consumers.
 *
 * Downstream packages should import these shapes from `@peteqian/browser-agent-sdk`
 * instead of redefining them locally so the package boundary can move without
 * breaking the integration contract.
 */

/**
 * A single action exposed to native tool-calling transports as a callable
 * tool. `parameters` is the JSON Schema of the action's params (derived from
 * its zod schema). Text/JSON adapters ignore this and use `actionCatalog`.
 */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Snapshot of what the AI sees before choosing the next action. */
export interface AgentInput {
  task: string;
  step: number;
  browserState?: BrowserStateSummary;
  observation: string;
  tabs: string[];
  activeTab: string;
  history: Array<{ action: string; result: string }>;
  actionCatalog?: string;
  /**
   * Action tool definitions for native tool-calling transports. Populated by
   * the loop from the registry for the current browser state. Text/JSON
   * adapters ignore it; tool-calling adapters turn each entry into a provider
   * tool. Changes between steps when state-scoped actions appear/disappear.
   */
  tools?: ToolDef[];
  /**
   * Persistent run memory carried across decisions. The loop initializes
   * this from the Agent memory option and updates it whenever an `AgentOutput`
   * returns a new `memory` field. Adapters should surface it in the
   * prompt so the model can rely on it across steps.
   */
  memory?: string;
}

/** Raw AI-proposed action before schema parsing and execution. */
export interface AgentOutputAction {
  name: string;
  params: unknown;
}

/** Structured AI output consumed by the Agent loop. */
export interface AgentOutput {
  thought?: string;
  memory?: string;
  evaluationPreviousGoal?: string;
  nextGoal?: string;
  plan?: PlanItem[];
  actions: AgentOutputAction[];
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
 * the Agent `onEvent` option to drive UIs, telemetry, or audit trails.
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
  | { type: "decision"; step: number; decision: AgentOutput }
  | {
      type: "action";
      step: number;
      url: string;
      action: AgentAction;
      result: { ok: boolean; message: string };
    }
  | { type: "transport_resolved"; resolution: TransportResolution }
  | { type: "loop_nudge"; step: number; notice: string; nudgesUsed: number; budget: number }
  | { type: "decision_started"; stepIndex: number; provider: string; model: string }
  | {
      type: "decision_completed";
      stepIndex: number;
      durationMs: number;
      tokensIn?: number;
      tokensOut?: number;
      /** Cached prompt tokens read (provider cache hit on prefix). */
      cacheReadTokens?: number;
      /** Tokens written into provider cache on this request. */
      cacheCreationTokens?: number;
    }
  | { type: "snapshot_started"; stepIndex: number }
  | {
      type: "snapshot_captured";
      stepIndex: number;
      durationMs: number;
      elementCount: number;
      bytes: number;
    }
  | { type: "action_started"; stepIndex: number; action: string }
  | {
      type: "action_completed";
      stepIndex: number;
      action: string;
      durationMs: number;
      ok: boolean;
    }
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
  | "max_failures"
  | "loop_detected"
  | "aborted"
  | "stopped"
  | "step_timeout"
  | "decision_timeout"
  | "schema_violation"
  | "decide_error"
  | "judge_failed";

/**
 * Final-validation hook. When the Agent `judge` option is set, the loop
 * invokes it after the model emits a successful `done` action and uses
 * the verdict to either confirm success or fail the run with
 * `reason: "judge_failed"`. Receives the final `AgentInput` along
 * with the model's terminal summary and (when present) typed data.
 */
/**
 * Hook for structured extraction. When the Agent `extractionLLM` option is set
 * and the model's `extract_content` action carries a `schemaJson`, the
 * executor passes the extracted markdown plus the schema to this hook and
 * surfaces the result as `data.structured` alongside the existing markdown
 * content. Validation is owned by the hook — the loop does not parse
 * `data` against the schema.
 */
export type ExtractionLLMFn = (input: {
  url: string;
  query: string;
  markdown: string;
  schemaJson?: string;
  signal?: AbortSignal;
}) => Promise<{ data: unknown }>;

export type JudgeFn<TData = unknown> = (input: {
  finalInput: AgentInput;
  summary: string;
  data: TData | null;
  signal?: AbortSignal;
}) => Promise<{ pass: boolean; reason?: string }>;

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
export type GetNextActionFn = (input: AgentInput, signal: AbortSignal) => Promise<AgentOutput>;

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
  decide: GetNextActionFn;
  /**
   * Capture screenshots and pass them to providers that support multimodal
   * input. Default: false. Set true to ship a screenshot per step (only
   * useful for vision-capable models).
   */
  vision?: boolean | "auto";
  /**
   * Always send a full DOM snapshot instead of a per-step diff. Default
   * false — the loop renders an element-level diff against the prior
   * snapshot when the URL is unchanged and churn is below 50%.
   */
  fullSnapshots?: boolean;
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
  /**
   * Identical-fingerprint loop detection mode. Default: `"nudge"`.
   * - `"nudge"`: inject a one-line notice into the next observation so the
   *   model can break the pattern; after `loopDetectionNudgeBudget` notices
   *   without progress, escalate to a hard stop.
   * - `"strict"`: hard-stop immediately when the fingerprint window repeats.
   * - `"off"`: skip loop detection entirely.
   *
   */
  loopDetectionMode?: "nudge" | "strict" | "off";
  /** Number of identical consecutive fingerprints to treat as a loop. Default: 4. */
  loopDetectionWindow?: number;
  /**
   * In `"nudge"` mode, the maximum number of consecutive nudges to emit
   * before escalating to a strict stop. Default: 2.
   */
  loopDetectionNudgeBudget?: number;
  /**
   * Head+tail compaction for the per-step action history surfaced to the
   * model. When the total history exceeds `historyHead + historyTail`, the
   * loop keeps the first `historyHead` entries plus the last `historyTail`,
   * with a synthetic `("...", "(N earlier steps omitted)")` marker between
   * them so the model sees how much was skipped. Default head 2, tail 8.
   * Set `historyHead: 0` to disable head retention; `historyTail` must be at
   * least 1.
   */
  historyHead?: number;
  historyTail?: number;
  /**
   * Initial run memory. Surfaced via `AgentInput.memory`; each model
   * `AgentOutput.memory` overwrites it for the next step. Use to inject
   * caller-known state (user identity, partial work product, task
   * constraints) that should outlive single observations.
   */
  memory?: string;
  /**
   * Optional final validator. Runs after the model emits a successful
   * `done` action and decides whether to confirm or fail the run.
   * Receives the last `AgentInput`, the model's summary, and any
   * `outputSchema`-typed `data`. Returning `pass: false` produces a
   * terminal with `reason: "judge_failed"` and the judge's `reason`
   * appended to the summary.
   */
  judge?: JudgeFn<TData>;
  /**
   * Cooperative control surface (pause/resume/stop). When set, the loop checks
   * `control.signal` and `control.waitIfPaused()` in addition to `signal`.
   * Both are honored; either aborting terminates the run. Use `control` for
   * interactive UIs and `signal` for plain cancellation.
   */
  control?: AgentControl;
  signal?: AbortSignal;
  /** Existing Chrome DevTools endpoint when the loop owns a remote/real browser connection. */
  cdpUrl?: string;
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
  /**
   * Map of placeholder key -> real secret. The model emits
   * `<secret>key</secret>` tokens in `type.text`; the agent substitutes
   * the real value at execute time. Real values never appear in prompts,
   * action history, events, or JSONL output. Unknown keys fail the
   * action. Currently applied to the `type` action only.
   *
   * Caveats:
   * - Password inputs return raw `.value` (not masked) for verification.
   * - Rich text editors that sanitize input may trigger `value_mismatch`.
   */
  sensitiveData?: Record<string, string>;
  /**
   * Window after a `click` action during which a newly attached page target
   * (e.g. `target=_blank`, OAuth popup) is treated as the click's intended
   * destination and becomes the loop's active page. Set to 0 to disable
   * detection. Default: 500ms.
   */
  newTabDetectMs?: number;
  /**
   * Optional structured-extraction hook. When set, an `extract_content`
   * action carrying a `schemaJson` param routes its extracted markdown
   * through this function; the hook's returned `data` is exposed as
   * `result.data.structured`. Without this hook, `schemaJson` is ignored.
   */
  extractionLLM?: ExtractionLLMFn;
  /**
   * Restrict `navigate` and `new_tab` actions to URLs whose host matches
   * one of these patterns. Each pattern is either an exact host
   * (`example.com`) or a wildcard (`*.example.com`, which also matches
   * the apex). Non-http(s) URLs (about:blank, file:) bypass the check.
   * Blocked navigations return a deterministic failure result without
   * touching the network. When undefined or empty, no restriction.
   */
  allowedDomains?: readonly string[];
}
