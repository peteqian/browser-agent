/**
 * Internal exports — implementation details that escape the package boundary
 * but are not part of the stable consumer API. May change without bumping the
 * minor version. Use `@peteqian/browser-agent-sdk/internal` to opt in.
 */

export { CDPClient } from "./cdp/client";
export { launchBrowser } from "./cdp/launch";
export type { LaunchOptions, LaunchedBrowser } from "./cdp/launch";
export {
  discoverBrowserExecutable,
  installBrowser,
  ensureBrowserExecutable,
  getBrowserInstallStatus,
} from "./cdp/discovery";
export type { BrowserChannel, BrowserInstallResult, BrowserInstallStatus } from "./cdp/discovery";

export { BrowserProfile } from "./browser/profile";
export type {
  BrowserPermission,
  BrowserPermissionGrant,
  BrowserProfileInit,
} from "./browser/profile";
export { matchesAllowedDomains, parseAllowedDomainsInput } from "./browser/allowed-domains";
export type { NavigationHealthResult, NavigationHealthStatus } from "./browser/session";
export type { BrowserOriginStorageState, BrowserStorageState } from "./browser/storage-state";
export {
  readStorageStateFile,
  writeStorageStateFile,
  createEmptyStorageState,
} from "./browser/storage-state";

export { serializePage, formatSnapshotForLLM } from "./dom/serialize";
export { captureCdpSnapshot, withBudgetDefaults, DEFAULT_DOM_BUDGETS } from "./dom/cdp-snapshot";
export type {
  DomBudgetOptions,
  SelectorMap,
  SelectorMapEntry,
  RequiredDomBudgets,
} from "./dom/cdp-snapshot";
export type { ElementInfo, ElementBBox, PageSnapshot } from "./dom/types";
export { captureBrowserState } from "./browser/state";
export type { BrowserStateSummary, ScreenshotState } from "./browser/state";
export { observePage, refreshPageState } from "./runtime/observer";
export type { ObservePageOptions, RefreshPageStateOptions } from "./runtime/observer";
export { executeRuntimeAction, runRuntimeActions, shouldReobserve } from "./runtime/executor";
export type {
  ExecuteRuntimeActionOptions,
  RunRuntimeActionsOptions,
  RuntimeAction,
  RuntimeActionResult,
  RuntimeActionsResult,
} from "./runtime/executor";
export { SessionRunner } from "./runtime/session-runner";
export type {
  RunActionOptions,
  RunActionsOptions,
  SessionRunnerOptions,
} from "./runtime/session-runner";

export { executeAction } from "./actions/execute";
export type { ActionResult } from "./actions/execute";
export { actionSchemas } from "./actions/types";
export type { Action, ActionName } from "./actions/types";
export {
  ActionRegistry,
  createActionRegistry,
  createDefaultActionRegistry,
  createDefaultActions,
} from "./actions/registry";
export type { ActionDefinition, ActionContext, RegisteredAction } from "./actions/registry";

export { buildDecisionPrompt } from "./agent/loop";
export { SYSTEM_PROMPT } from "./agent/prompts";
