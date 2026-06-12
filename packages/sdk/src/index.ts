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

export { AgentController } from "./agent/loop";
export { createCodexCliDecide } from "./agent/codexCliDecide";
export type { CodexCliOptions } from "./agent/codexCliDecide";
export { createCodexSdkDecide } from "./agent/codexSdkDecide";
export type { CodexSdkOptions } from "./agent/codexSdkDecide";
export { createClaudeCliDecide } from "./agent/claudeCliDecide";
export type { ClaudeCliOptions } from "./agent/claudeCliDecide";
export { createClaudeSdkDecide } from "./agent/claudeSdkDecide";
export type { ClaudeSdkOptions } from "./agent/claudeSdkDecide";
export type { DomBudgetOptions, SelectorMap } from "./dom/cdp-snapshot";
export type { ElementInfo, ElementBBox, PageSnapshot } from "./dom/types";
export { RunReportCollector, toJUnitXml } from "./agent/report";
export type { RunReport, RunReportStep, RunReportCollectorOptions } from "./agent/report";
export { reportToOtel } from "./agent/otel";
export type { OtelExport, OtelSpan, OtelMetric, OtelSpanStatus } from "./agent/otel";
export { TraceRecorder, renderTimelineHtml } from "./agent/trace";
export type { TraceRecorderOptions, TraceManifest } from "./agent/trace";
export { planAutofill, autofillActions, AnswerBank } from "./agent/autofill";
export type { ApplicantProfile, AutofillSuggestion, AutofillFieldKind } from "./agent/autofill";
export { redactString, redactValue, redactReport } from "./agent/redact";
export type { RedactOptions } from "./agent/redact";
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
} from "./agent/contracts";

export { Browser } from "./browser/browser";
export type { BrowserOptions } from "./browser/browser";
export { Agent, runTask } from "./agent/agent";
export type { AgentProviderOptions, SimpleAgentOptions } from "./agent/agent";

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

export { withRetry, defaultShouldRetry, DEFAULT_RETRY } from "./agent/retry";
export type { RetryOptions } from "./agent/retry";
