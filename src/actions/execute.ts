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
  handleScroll,
  handleSelectOption,
  handleSendKeys,
  handleType,
  handleUploadFile,
  handleWait,
  handleWaitForText,
} from "./handlers/interaction";
import {
  handleDone,
  handleExtractContent,
  handleFindElements,
  handleFindText,
  handleGetDropdownOptions,
  handleSaveAsPdf,
  handleScreenshot,
  handleSearchPage,
} from "./handlers/extraction";

export type { ActionResult } from "./handlers/shared";

export async function executeAction(
  page: Page,
  action: Action,
  session?: BrowserSession,
  signal?: AbortSignal,
  selectorMap?: SelectorMap,
  sensitiveData?: Record<string, string>,
  newTabDetectMs?: number,
  extractionLLM?: ExtractionLLMFn,
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
  };

  try {
    switch (action.name) {
      case "navigate":
        return await handleNavigate(ctx, action);
      case "click":
        return await handleClick(ctx, action);
      case "type":
        return await handleType(ctx, action);
      case "scroll":
        return await handleScroll(ctx, action);
      case "wait":
        return await handleWait(ctx, action);
      case "send_keys":
        return await handleSendKeys(ctx, action);
      case "select_option":
        return await handleSelectOption(ctx, action);
      case "upload_file":
        return await handleUploadFile(ctx, action);
      case "wait_for_text":
        return await handleWaitForText(ctx, action);
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
      case "done":
        return handleDone(ctx, action);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return fail(`Action ${action.name} failed: ${message}`);
  }
}
