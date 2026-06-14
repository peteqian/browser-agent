/**
 * Public consumer surface for `@peteqian/browser-agent-sdk`.
 *
 * Implementation details (raw CDP, profile mgmt, DOM serializer, action
 * executor, prompt internals) live behind `@peteqian/browser-agent-sdk/internal`
 * — that subpath has no stability guarantee.
 */

export { BrowserSession, Page } from "./browser/session";
export type {
  BrowserSessionConnectOptions,
  NavigationHealthResult,
  NavigationHealthStatus,
} from "./browser/session";
export type { BrowserPermission, BrowserPermissionGrant } from "./browser/profile";
export {
  resolveFingerprint,
  buildFingerprintInitScript,
  buildUserAgentOverride,
} from "./browser/fingerprint";
export type {
  FingerprintInit,
  FingerprintPreset,
  FingerprintProfile,
  ResolvedFingerprint,
} from "./browser/fingerprint";
export type { HumanizeConfig, HumanizeInit } from "./browser/humanize";
export {
  ChallengeWatchdog,
  challengeObservationNote,
  detectChallenge,
} from "./browser/watchdogs/challenge";
export type {
  ChallengeDetection,
  ChallengeEncounter,
  ChallengeVendor,
  ChallengeWatchdogOptions,
  CaptchaSolver,
  CaptchaSolveRequest,
  CaptchaSolveResult,
} from "./browser/watchdogs/challenge";
export {
  LoginWallWatchdog,
  detectLoginWall,
  loginWallObservationNote,
} from "./browser/watchdogs/login-wall";
export type {
  LoginWallDetection,
  LoginWallEncounter,
  LoginWallSignal,
} from "./browser/watchdogs/login-wall";
export type { BrowserOriginStorageState, BrowserStorageState } from "./browser/storage-state";
export {
  saveState,
  loadState,
  listStates,
  showState,
  renameState,
  clearState,
  cleanAllStates,
  resolveStateVaultDir,
} from "./browser/state-vault";
export type { StateVaultOptions, StateSummary, StateListEntry } from "./browser/state-vault";
export { captureBrowserState } from "./browser/state";
export type {
  BrowserStateSummary,
  BrowserStateOptions,
  ScreenshotState,
  TabState,
} from "./browser/state";
export { BrowserEventBus } from "./browser/events";
export type { BrowserEvent, BrowserEventHandler } from "./browser/events";

export {
  ActionRegistry,
  createActionRegistry,
  createDefaultActionRegistry,
  createDefaultActions,
} from "./actions/registry";
export type { ActionContext, ActionDefinition } from "./actions/registry";
export type { RegisteredAction } from "./actions/registry";
export type { ActionResult } from "./actions/execute";

export { AgentController } from "./agent/core/loop";
export { createCodexCliDecide } from "./llm/providers/codexCliDecide";
export type { CodexCliOptions } from "./llm/providers/codexCliDecide";
export { createCodexSdkDecide } from "./llm/providers/codexSdkDecide";
export type { CodexSdkOptions } from "./llm/providers/codexSdkDecide";
export { createClaudeCliDecide } from "./llm/providers/claudeCliDecide";
export type { ClaudeCliOptions } from "./llm/providers/claudeCliDecide";
export { createClaudeSdkDecide } from "./llm/providers/claudeSdkDecide";
export type { ClaudeSdkOptions } from "./llm/providers/claudeSdkDecide";
export type { DomBudgetOptions, SelectorMap } from "./dom/cdp-snapshot";
export type { ElementInfo, ElementBBox, PageSnapshot } from "./dom/types";
export { RunReportCollector, toJUnitXml } from "./agent/observe/report";
export type { RunReport, RunReportStep, RunReportCollectorOptions } from "./agent/observe/report";
export { reportToOtel } from "./agent/observe/otel";
export type { OtelExport, OtelSpan, OtelMetric, OtelSpanStatus } from "./agent/observe/otel";
export { TraceRecorder, renderTimelineHtml } from "./agent/observe/trace";
export type { TraceRecorderOptions, TraceManifest } from "./agent/observe/trace";
export { planAutofill, autofillActions, AnswerBank } from "./agent/features/autofill";
export type { ApplicantProfile, AutofillSuggestion, AutofillFieldKind } from "./agent/features/autofill";
export { redactString, redactValue, redactReport } from "./agent/observe/redact";
export type { RedactOptions } from "./agent/observe/redact";
export { ProxyPool, resolveProxyLaunch } from "./browser/proxy-pool";
export type { ProxyEntry, ProxyPoolOptions, ProxyRotationStrategy } from "./browser/proxy-pool";
export { RateLimiter } from "./runtime/rate-limit";
export type { RateLimitConfig } from "./runtime/rate-limit";
export { checkPostCondition } from "./runtime/post-condition";
export type { PostCondition, PostConditionResult } from "./runtime/post-condition";
export { estimateCostUsd, resolveModelPricing, DEFAULT_MODEL_PRICING } from "./llm/pricing";
export type { ModelPricing } from "./llm/pricing";
export type {
  AgentBudget,
  AgentControl,
  AgentEvent,
  AgentInput,
  AgentOutput,
  AgentOutputAction,
  AgentResult,
  EnvId,
  GetNextActionFn,
  OnEventCallback,
  StepInfo,
  TerminalReason,
  TransportId,
  TransportResolution,
  PlanItem,
  JudgeFn,
  ExtractionLLMFn,
} from "./agent/decide/contracts";

export { Browser } from "./browser/browser";
export type { BrowserOptions } from "./browser/browser";
export { Agent, runTask } from "./agent/core/agent";
export type { AgentProviderOptions, SimpleAgentOptions } from "./agent/core/agent";

export {
  createOpenAIDecide,
  createAnthropicDecide,
  createDecide,
  resolveTransport,
  detectEnv,
} from "./llm";
export type {
  CreateDecideOptions,
  DecisionTelemetry,
  LLMAdapterOptions,
  ProviderId,
  ResolveOptions,
  ResolvedDecide,
  TokenUsage,
} from "./llm";

export { VERSION, PACKAGE_NAME } from "./version";

export { createDefaultLogger, noopLogger } from "./logger";
export type { Logger, LogLevel } from "./logger";

export { withRetry, defaultShouldRetry, DEFAULT_RETRY } from "./agent/core/retry";
export type { RetryOptions } from "./agent/core/retry";
