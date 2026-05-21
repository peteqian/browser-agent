import type { BrowserSession, Page } from "../browser/session";
import type { SelectorMap } from "../dom/cdp-snapshot";
import type { Action } from "./types";
import type { ExtractionLLMFn } from "../agent/contracts";

import { fail, type ActionResult, type HandlerContext } from "./handlers/shared";
import {
  handleCloseBrowser,
  handleCloseTab,
  handleGoBack,
  handleGoForward,
  handleNavigate,
  handleNewTab,
  handleRefresh,
  handleSwitchTab,
} from "./handlers/navigation";
import {
  handleClick,
  handleDblclick,
  handleFill,
  handleFocus,
  handleHover,
  handleKeyboardType,
  handleScroll,
  handleClickBy,
  handleSelectBy,
  handleSelectOption,
  handleSendKeys,
  handlePress,
  handleType,
  handleTypeBy,
  handleUploadFile,
  handleWait,
  handleWaitForCondition,
  handleWaitForText,
  handleWaitForUrl,
} from "./handlers/interaction";
import {
  handleDone,
  handleEval,
  handleExtractContent,
  handleFindElements,
  handleFindText,
  handleFocusArea,
  handleGetDropdownOptions,
  handleSaveAsPdf,
  handleScreenshot,
  handleSearchPage,
} from "./handlers/extraction";
import { handleFindByRole, handleFindByText, handleFindByTestid } from "./handlers/find";
import { handleDialogHandle } from "./handlers/dialog";
import {
  handleNetworkHarStart,
  handleNetworkHarStop,
  handleNetworkListRequests,
} from "./handlers/network";
import { handleConsoleRead, handleConsoleStart, handleConsoleStop } from "./handlers/console";
import { handleSetViewport } from "./handlers/emulation";
import { handleCookiesClear, handleCookiesGet, handleCookiesSet } from "./handlers/cookies";
import { handleProfilerStart, handleProfilerStop } from "./handlers/profiler";
import type { FocusState } from "../agent/focus-state";
import type { ElementInfo } from "../dom/types";

export type { ActionResult } from "./handlers/shared";

export interface ExecuteActionExtras {
  focusState?: FocusState;
  snapshotElements?: readonly ElementInfo[];
  currentStep?: number;
  currentUrl?: string;
  allowedDomains?: readonly string[];
}

export async function executeAction(
  page: Page,
  action: Action,
  session?: BrowserSession,
  signal?: AbortSignal,
  selectorMap?: SelectorMap,
  sensitiveData?: Record<string, string>,
  newTabDetectMs?: number,
  extractionLLM?: ExtractionLLMFn,
  extras?: ExecuteActionExtras,
): Promise<ActionResult> {
  if (signal?.aborted) {
    return fail(`Action ${action.name} aborted before execution`);
  }

  const ctx: HandlerContext = {
    page,
    session,
    signal,
    selectorMap,
    sensitiveData,
    newTabDetectMs,
    extractionLLM,
    focusState: extras?.focusState,
    snapshotElements: extras?.snapshotElements,
    currentStep: extras?.currentStep,
    currentUrl: extras?.currentUrl,
    allowedDomains: extras?.allowedDomains,
  };

  try {
    switch (action.name) {
      case "navigate":
        return await handleNavigate(ctx, action);
      case "click":
        return await handleClick(ctx, action);
      case "focus":
        return await handleFocus(ctx, action);
      case "type":
        return await handleType(ctx, action);
      case "fill":
        return await handleFill(ctx, action);
      case "scroll":
        return await handleScroll(ctx, action);
      case "wait":
        return await handleWait(ctx, action);
      case "send_keys":
        return await handleSendKeys(ctx, action);
      case "press":
        return await handlePress(ctx, action);
      case "keyboard_type":
        return await handleKeyboardType(ctx, action);
      case "select_option":
        return await handleSelectOption(ctx, action);
      case "upload_file":
        return await handleUploadFile(ctx, action);
      case "wait_for_text":
        return await handleWaitForText(ctx, action);
      case "wait_for_condition":
        return await handleWaitForCondition(ctx, action);
      case "wait_for_url":
        return await handleWaitForUrl(ctx, action);
      case "go_back":
        return await handleGoBack(ctx);
      case "go_forward":
        return await handleGoForward(ctx);
      case "refresh":
        return await handleRefresh(ctx);
      case "new_tab":
        return await handleNewTab(ctx, action);
      case "switch_tab":
        return await handleSwitchTab(ctx, action);
      case "close_tab":
        return await handleCloseTab(ctx, action);
      case "close_browser":
        return await handleCloseBrowser(ctx, action);
      case "search_page":
        return await handleSearchPage(ctx, action);
      case "find_elements":
        return await handleFindElements(ctx, action);
      case "get_dropdown_options":
        return await handleGetDropdownOptions(ctx, action);
      case "find_text":
        return await handleFindText(ctx, action);
      case "screenshot":
        return await handleScreenshot(ctx, action);
      case "save_as_pdf":
        return await handleSaveAsPdf(ctx, action);
      case "extract_content":
        return await handleExtractContent(ctx, action);
      case "focus_area":
        return handleFocusArea(ctx, action);
      case "click_by":
        return await handleClickBy(ctx, action);
      case "type_by":
        return await handleTypeBy(ctx, action);
      case "select_by":
        return await handleSelectBy(ctx, action);
      case "hover":
        return await handleHover(ctx, action);
      case "dblclick":
        return await handleDblclick(ctx, action);
      case "eval":
        return await handleEval(ctx, action);
      case "find_by_role":
        return handleFindByRole(ctx, action);
      case "find_by_text":
        return handleFindByText(ctx, action);
      case "find_by_testid":
        return handleFindByTestid(ctx, action);
      case "dialog_handle":
        return await handleDialogHandle(ctx, action);
      case "network_har_start":
        return await handleNetworkHarStart(ctx, action);
      case "network_har_stop":
        return await handleNetworkHarStop(ctx, action);
      case "network_list_requests":
        return await handleNetworkListRequests(ctx, action);
      case "set_viewport":
        return await handleSetViewport(ctx, action);
      case "cookies_get":
        return await handleCookiesGet(ctx, action);
      case "cookies_set":
        return await handleCookiesSet(ctx, action);
      case "cookies_clear":
        return await handleCookiesClear(ctx, action);
      case "console_start":
        return await handleConsoleStart(ctx, action);
      case "console_read":
        return handleConsoleRead(ctx, action);
      case "console_stop":
        return handleConsoleStop(ctx, action);
      case "profiler_start":
        return await handleProfilerStart(ctx, action);
      case "profiler_stop":
        return await handleProfilerStop(ctx, action);
      case "done":
        return handleDone(ctx, action);
      default: {
        const exhaustive: never = action;
        return fail(`Unknown action: ${JSON.stringify(exhaustive)}`);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`Action ${action.name} failed: ${message}`);
  }
}
