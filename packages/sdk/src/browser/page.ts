import type { BrowserSession } from "./session";
import { formatRuntimeException } from "./session-helpers";
import type {
  ExtractContentParams,
  ExtractContentResult,
  FindElementsParams,
  NavigationHealthResult,
  PendingNetworkRequest,
  RuntimeExceptionDetails,
  SearchPageParams,
} from "./session-types";

import {
  currentUrl,
  goBack,
  goForward,
  goto,
  navigateWithHealthCheck,
  refresh,
  scrollToText,
  waitForStablePage,
  waitForText,
} from "./page-navigation";
import {
  clickAtCoordinates,
  clickByBackendNodeId,
  findNearestFileInputBackendNodeId,
  getDropdownOptionsByBackendNodeId,
  scroll,
  scrollByPages,
  selectOptionByBackendNodeId,
  sendKeys,
  typeByBackendNodeId,
  uploadFilesByBackendNodeId,
} from "./page-input";
import {
  extractContent,
  findElements,
  getPendingNetworkRequests,
  origin,
  readLocalStorage,
  searchPage,
} from "./page-scripts";
import {
  saveAsPdf,
  screenshot,
  screenshotToFile,
  type SaveAsPdfOptions,
  type ScreenshotOptions,
} from "./page-output";
import { setTimeout as delay } from "node:timers/promises";

export class Page {
  readonly session: BrowserSession;
  readonly targetId: string;

  constructor(session: BrowserSession, targetId: string) {
    this.session = session;
    this.targetId = targetId;
  }

  // ============================================================
  // CDP primitives — building blocks every other method shares.
  // ============================================================

  async sendCDP<TResult = unknown>(
    method: string,
    params: Record<string, unknown> = {},
  ): Promise<TResult> {
    return this.session.sendToTarget<TResult>(this.targetId, method, params);
  }

  async evaluate<TResult = unknown>(expression: string): Promise<TResult> {
    const result = await this.sendCDP<{
      result: { value?: TResult };
      exceptionDetails?: RuntimeExceptionDetails;
    }>("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `Runtime evaluation failed: ${formatRuntimeException(result.exceptionDetails)}`,
      );
    }
    return result.result.value as TResult;
  }

  async evaluateHandle(expression: string): Promise<string> {
    const result = await this.sendCDP<{
      result: { objectId?: string };
      exceptionDetails?: RuntimeExceptionDetails;
    }>("Runtime.evaluate", {
      expression,
      returnByValue: false,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(
        `Runtime evaluation handle failed: ${formatRuntimeException(result.exceptionDetails)}`,
      );
    }
    if (!result.result.objectId) {
      throw new Error("Runtime evaluation did not return an object handle");
    }
    return result.result.objectId;
  }

  async resolveBackendNode(backendNodeId: number): Promise<string | null> {
    try {
      const res = await this.sendCDP<{ object?: { objectId?: string } }>("DOM.resolveNode", {
        backendNodeId,
      });
      return res.object?.objectId ?? null;
    } catch {
      return null;
    }
  }

  async releaseObject(objectId: string): Promise<void> {
    await this.sendCDP("Runtime.releaseObject", { objectId }).catch(() => {});
  }

  /**
   * Call a function on a node identified by backendNodeId. Returns
   * `{ ok: false, reason: "index_stale" }` when the node no longer exists.
   */
  async callOnBackendNode<TResult = unknown>(
    backendNodeId: number,
    functionDeclaration: string,
    args: unknown[] = [],
  ): Promise<
    | { ok: true; value: TResult }
    | { ok: false; reason: "index_stale" }
    | { ok: false; reason: "exception"; error: string }
  > {
    const objectId = await this.resolveBackendNode(backendNodeId);
    if (!objectId) return { ok: false, reason: "index_stale" };
    try {
      const res = await this.sendCDP<{
        result: { value?: TResult };
        exceptionDetails?: RuntimeExceptionDetails;
      }>("Runtime.callFunctionOn", {
        functionDeclaration,
        objectId,
        returnByValue: true,
        awaitPromise: true,
        arguments: args.map((value) => ({ value })),
      });
      if (res.exceptionDetails) {
        return {
          ok: false,
          reason: "exception",
          error: formatRuntimeException(res.exceptionDetails),
        };
      }
      return { ok: true, value: res.result.value as TResult };
    } finally {
      await this.releaseObject(objectId);
    }
  }

  // ============================================================
  // Page lifecycle and small helpers.
  // ============================================================

  async waitForTimeout(ms: number): Promise<void> {
    await delay(ms);
  }

  async currentUrl(): Promise<string> {
    return currentUrl(this);
  }

  async title(): Promise<string> {
    return this.evaluate<string>("document.title");
  }

  async content(): Promise<string> {
    return this.evaluate<string>("document.documentElement.outerHTML");
  }

  async close(): Promise<void> {
    await this.session.closePage(this.targetId);
  }

  async origin(): Promise<string> {
    return origin(this);
  }

  async readLocalStorage(): Promise<Record<string, string>> {
    return readLocalStorage(this);
  }

  // ============================================================
  // Delegating wrappers — public API surface.
  // ============================================================

  goto(url: string, waitUntil?: "load" | "domcontentloaded"): Promise<void> {
    return goto(this, url, waitUntil);
  }
  goBack(): Promise<boolean> {
    return goBack(this);
  }
  goForward(): Promise<boolean> {
    return goForward(this);
  }
  refresh(): Promise<void> {
    return refresh(this);
  }
  navigateWithHealthCheck(url: string): Promise<NavigationHealthResult> {
    return navigateWithHealthCheck(this, url);
  }
  waitForStablePage(timeoutMs?: number): Promise<void> {
    return waitForStablePage(this, timeoutMs);
  }
  waitForText(text: string, timeoutMs?: number): Promise<boolean> {
    return waitForText(this, text, timeoutMs);
  }
  scrollToText(text: string): Promise<boolean> {
    return scrollToText(this, text);
  }

  clickByBackendNodeId(backendNodeId: number) {
    return clickByBackendNodeId(this, backendNodeId);
  }
  clickAtCoordinates(x: number, y: number): Promise<void> {
    return clickAtCoordinates(this, x, y);
  }
  typeByBackendNodeId(
    backendNodeId: number,
    text: string,
    submit?: boolean,
    mode?: "replace" | "append",
  ) {
    return typeByBackendNodeId(this, backendNodeId, text, submit, mode);
  }
  selectOptionByBackendNodeId(backendNodeId: number, valueOrLabel: string) {
    return selectOptionByBackendNodeId(this, backendNodeId, valueOrLabel);
  }
  sendKeys(keys: string): Promise<void> {
    return sendKeys(this, keys);
  }
  findNearestFileInputBackendNodeId(backendNodeId: number) {
    return findNearestFileInputBackendNodeId(this, backendNodeId);
  }
  uploadFilesByBackendNodeId(backendNodeId: number, filePaths: string[]) {
    return uploadFilesByBackendNodeId(this, backendNodeId, filePaths);
  }
  scroll(direction: "up" | "down" | "top" | "bottom", amount?: number, backendNodeId?: number) {
    return scroll(this, direction, amount, backendNodeId);
  }
  scrollByPages(
    direction: "up" | "down" | "top" | "bottom",
    pages?: number,
    backendNodeId?: number,
  ) {
    return scrollByPages(this, direction, pages, backendNodeId);
  }
  getDropdownOptionsByBackendNodeId(backendNodeId: number) {
    return getDropdownOptionsByBackendNodeId(this, backendNodeId);
  }

  searchPage(params: SearchPageParams) {
    return searchPage(this, params);
  }
  findElements(params: FindElementsParams) {
    return findElements(this, params);
  }
  extractContent(params: ExtractContentParams): Promise<ExtractContentResult> {
    return extractContent(this, params);
  }
  getPendingNetworkRequests(limit?: number): Promise<PendingNetworkRequest[]> {
    return getPendingNetworkRequests(this, limit);
  }

  screenshot(options?: ScreenshotOptions): Promise<string> {
    return screenshot(this, options);
  }
  screenshotToFile(fileName?: string, options?: ScreenshotOptions): Promise<string> {
    return screenshotToFile(this, fileName, options);
  }
  saveAsPdf(options?: SaveAsPdfOptions): Promise<string> {
    return saveAsPdf(this, options);
  }
}
