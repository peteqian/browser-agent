/**
 * Public consumer surface for `@browser-agent/core`.
 *
 * Implementation details (raw CDP, profile mgmt, DOM serializer, action
 * executor, prompt internals) live behind `@browser-agent/core/internal`
 * — that subpath has no stability guarantee.
 */

export { Browser } from "./browser/browser";
export type { BrowserOptions } from "./browser/browser";
export { BrowserSession, Page } from "./browser/session";
export type { NavigationHealthResult, NavigationHealthStatus } from "./browser/session";
export type { BrowserPermission, BrowserPermissionGrant } from "./browser/profile";
export type { BrowserOriginStorageState, BrowserStorageState } from "./browser/storage-state";
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

export { AgentController, runAgent } from "./agent/loop";
export { Agent } from "./agent/agent";
export type { AgentProviderOptions, SimpleAgentOptions } from "./agent/agent";
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
export type {
  AgentControl,
  AgentEvent,
  AgentOptions,
  AgentInput,
  AgentOutput,
  AgentOutputAction,
  AgentResult,
  GetNextActionFn,
  EnvId,
  OnEventCallback,
  StepInfo,
  TerminalReason,
  TransportId,
  TransportResolution,
  PlanItem,
  JudgeFn,
  ExtractionLLMFn,
} from "./agent/contracts";

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

export { createServer as createMcpServer, runStdioServer } from "./mcp/server";

export { VERSION, PACKAGE_NAME } from "./version";

export { createDefaultLogger, noopLogger } from "./logger";
export type { Logger, LogLevel } from "./logger";

export { withRetry, defaultShouldRetry, DEFAULT_RETRY } from "./agent/retry";
export type { RetryOptions } from "./agent/retry";
