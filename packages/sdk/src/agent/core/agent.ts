import type { z } from "zod/v4";

import type { LaunchOptions } from "../../cdp/launch";
import type { Browser } from "../../browser/browser";
import { createDecide, type CreateDecideOptions, type ProviderId } from "../../llm/transport/createDecide";
import { runLoop } from "./loop";
import type {
  AgentControl,
  GetNextActionFn,
  AgentOptions,
  AgentResult,
  ExtractionLLMFn,
  JudgeFn,
  OnEventCallback,
  StepInfo,
  TransportResolution,
} from "../decide/contracts";
import type { ActionDefinition, ActionRegistry } from "../../actions/registry";
import type { BrowserSession, Page } from "../../browser/session/session";
import { resolveBrowserPaths } from "../../browser/identity/profile-paths";
import type { DomBudgetOptions } from "../../dom/cdp-snapshot";
import type { RetryOptions } from "./retry";

export type AgentProviderOptions = Pick<
  CreateDecideOptions,
  | "provider"
  | "model"
  | "apiKey"
  | "baseURL"
  | "effort"
  | "env"
  | "transport"
  | "decisionMode"
  | "logger"
  | "onCodexRaw"
>;

export type AgentLlm = "auto" | ProviderId | AgentProviderOptions | GetNextActionFn;

export interface SimpleAgentOptions<TData = unknown> extends Partial<AgentProviderOptions> {
  task: string;
  llm?: AgentLlm;
  getNextAction?: GetNextActionFn;
  browser?: Browser;
  browserSession?: BrowserSession;
  browser_session?: BrowserSession;
  startUrl?: string;
  /**
   * Named persistent profile stored under ~/.browser-agent/profiles/<name>.
   * Use this for one-shot authenticated tasks without creating a Browser first.
   */
  profile?: string;
  initialActions?: unknown[];
  initial_actions?: unknown[];
  headless?: boolean;
  cdpUrl?: string;
  userDataDir?: string;
  storageStatePath?: string;
  saveStorageStateOnClose?: boolean;
  launch?: LaunchOptions;
  useVision?: boolean | "auto";
  use_vision?: boolean | "auto";
  vision?: boolean | "auto";
  enablePlanning?: boolean;
  enable_planning?: boolean;
  planning?: boolean;
  fullSnapshots?: boolean;
  full_snapshots?: boolean;
  tools?: ActionRegistry | ActionDefinition[];
  controller?: ActionRegistry | ActionDefinition[];
  actions?: ActionRegistry | ActionDefinition[];
  outputModelSchema?: z.ZodType<TData>;
  output_model_schema?: z.ZodType<TData>;
  outputSchema?: z.ZodType<TData>;
  maxFailures?: number;
  max_failures?: number;
  finalResponseAfterFailure?: boolean;
  final_response_after_failure?: boolean;
  stepTimeout?: number;
  step_timeout?: number;
  stepTimeoutMs?: number;
  actionTimeout?: number;
  action_timeout?: number;
  actionTimeoutMs?: number;
  llmTimeout?: number;
  llm_timeout?: number;
  decisionTimeoutMs?: number;
  decideRetry?: RetryOptions;
  loopDetectionMode?: "nudge" | "strict" | "off";
  loop_detection_mode?: "nudge" | "strict" | "off";
  loopDetectionWindow?: number;
  loop_detection_window?: number;
  loopDetectionNudgeBudget?: number;
  historyHead?: number;
  historyTail?: number;
  memory?: string;
  judge?: JudgeFn<TData>;
  control?: AgentControl;
  signal?: AbortSignal;
  page?: Page;
  session?: BrowserSession;
  onStep?: (info: StepInfo) => void;
  onEvent?: OnEventCallback<TData>;
  domBudgets?: DomBudgetOptions;
  sensitiveData?: Record<string, string>;
  sensitive_data?: Record<string, string>;
  newTabDetectMs?: number;
  extractionLLM?: ExtractionLLMFn;
  allowedDomains?: readonly string[];
  transportResolution?: TransportResolution;
  /** Bot-challenge watchdog config; default enabled. See AgentOptions.challengeWatchdog. */
  challengeWatchdog?: boolean | import("../../browser/watchdogs/challenge").ChallengeWatchdogOptions;
  /** Login-wall detection; default enabled. See AgentOptions.loginWallWatchdog. */
  loginWallWatchdog?: boolean;
  /** Reuse the prior snapshot when the page is unchanged; default true. See AgentOptions.snapshotReuse. */
  snapshotReuse?: boolean;
  /** Stale-element self-healing; default true. See AgentOptions.selfHealing. */
  selfHealing?: boolean;
  /** Politeness rate limiting between actions. See AgentOptions.rateLimit. */
  rateLimit?: import("../../runtime/rate-limit").RateLimitConfig;
  /** Token/cost ceiling for the run. See AgentBudget. */
  budget?: import("../decide/contracts").AgentBudget;
}

/**
 * Public task runner. Create an Agent with one task, then call run().
 */
export class Agent<TData = unknown> {
  private readonly options: SimpleAgentOptions<TData>;

  constructor(options: SimpleAgentOptions<TData>) {
    this.options = options;
  }

  async run(overrides: Partial<SimpleAgentOptions<TData>> = {}): Promise<AgentResult<TData>> {
    const options = normalizeOptions({ ...this.options, ...overrides });
    const { decide, resolution } = resolveLlm(options);

    const paths = resolveBrowserPaths({
      profile: options.profile,
      userDataDir: options.userDataDir ?? options.launch?.userDataDir,
      storageStatePath: options.storageStatePath ?? options.launch?.storageStatePath,
    });
    const launch = {
      ...options.launch,
      headless: options.headless ?? options.launch?.headless ?? true,
      userDataDir: paths.userDataDir,
      storageStatePath: paths.storageStatePath,
      saveStorageStateOnClose:
        options.saveStorageStateOnClose ?? options.launch?.saveStorageStateOnClose,
    };
    const session =
      options.session ??
      options.browserSession ??
      options.browser_session ??
      (await options.browser?.getSession());

    const agentOptions: AgentOptions<TData> = {
      ...options,
      launch,
      cdpUrl: options.cdpUrl,
      session,
      decide,
      transportResolution: resolution ?? options.transportResolution,
    };

    return runLoop<TData>(agentOptions);
  }
}

/**
 * One-shot task runner for the common case.
 */
export async function runTask<TData = unknown>(
  options: SimpleAgentOptions<TData>,
): Promise<AgentResult<TData>> {
  return new Agent<TData>(options).run();
}

function normalizeOptions<TData>(
  options: SimpleAgentOptions<TData>,
): SimpleAgentOptions<TData> & Partial<AgentOptions<TData>> {
  return {
    ...options,
    actions: options.actions ?? options.tools ?? options.controller,
    outputSchema: options.outputSchema ?? options.outputModelSchema ?? options.output_model_schema,
    vision: options.vision ?? options.useVision ?? options.use_vision,
    planning: options.planning ?? options.enablePlanning ?? options.enable_planning,
    fullSnapshots: options.fullSnapshots ?? options.full_snapshots,
    maxFailures: options.maxFailures ?? options.max_failures,
    finalResponseAfterFailure:
      options.finalResponseAfterFailure ?? options.final_response_after_failure,
    stepTimeoutMs: options.stepTimeoutMs ?? toMs(options.stepTimeout ?? options.step_timeout),
    actionTimeoutMs:
      options.actionTimeoutMs ?? toMs(options.actionTimeout ?? options.action_timeout),
    decisionTimeoutMs: options.decisionTimeoutMs ?? toMs(options.llmTimeout ?? options.llm_timeout),
    loopDetectionMode: options.loopDetectionMode ?? options.loop_detection_mode,
    loopDetectionWindow: options.loopDetectionWindow ?? options.loop_detection_window,
    sensitiveData: options.sensitiveData ?? options.sensitive_data,
  };
}

function resolveLlm<TData>(options: SimpleAgentOptions<TData>): {
  decide: GetNextActionFn;
  resolution?: ReturnType<typeof createDecide>["resolution"];
} {
  if (options.getNextAction) {
    return { decide: options.getNextAction };
  }

  if (typeof options.llm === "function") {
    return { decide: options.llm };
  }

  if (!options.llm || options.llm === "auto") {
    return resolveAutoLlm(options);
  }

  const llmOptions =
    typeof options.llm === "object"
      ? options.llm
      : {
          provider: options.llm ?? options.provider ?? "codex",
          model: options.model,
          apiKey: options.apiKey,
          baseURL: options.baseURL,
          effort: options.effort,
          env: options.env,
          transport: options.transport,
          decisionMode: options.decisionMode,
          logger: options.logger,
        };

  const { decide, resolution } = createDecide(llmOptions);
  return { decide, resolution };
}

function resolveAutoLlm<TData>(options: SimpleAgentOptions<TData>): {
  decide: GetNextActionFn;
  resolution: ReturnType<typeof createDecide>["resolution"];
} {
  const providers: ProviderId[] = ["codex", "claude", "openai", "anthropic"];
  const errors: string[] = [];

  for (const provider of providers) {
    try {
      return createDecide({
        provider,
        model: options.model,
        apiKey: options.apiKey,
        baseURL: options.baseURL,
        effort: options.effort,
        env: options.env,
        transport: options.transport,
        decisionMode: options.decisionMode,
        logger: options.logger,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider}: ${message}`);
    }
  }

  throw new Error(`No LLM transport available. Tried ${errors.join(" | ")}`);
}

function toMs(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return value * 1000;
}
