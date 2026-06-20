import type { BrowserProfileInit } from "../identity/profile";
import type { LaunchOptions } from "../../cdp/launch";

export type BrowserSessionState =
  | "idle"
  | "launching"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "disconnected"
  | "stopped";

export interface BrowserSessionOptions {
  profile?: BrowserProfileInit;
  launch?: LaunchOptions;
  cdpUrl?: string;
}

export type BrowserSessionConnectOptions = Omit<BrowserSessionOptions, "cdpUrl" | "launch">;

export interface AttachedTargetEvent {
  sessionId: string;
  targetInfo: { targetId: string; type: string; url: string; openerId?: string };
}

export interface DetachedTargetEvent {
  sessionId: string;
  targetId: string;
}

export interface JavascriptDialogOpeningEvent {
  type?: "alert" | "confirm" | "prompt" | "beforeunload";
  message?: string;
  url?: string;
  hasBrowserHandler?: boolean;
  defaultPrompt?: string;
}

export interface DownloadWillBeginEvent {
  frameId?: string;
  guid: string;
  url: string;
  suggestedFilename: string;
}

export interface DownloadProgressEvent {
  guid: string;
  totalBytes?: number;
  receivedBytes?: number;
  state: "inProgress" | "completed" | "canceled";
  filePath?: string;
}

export interface DownloadInfo {
  guid: string;
  url: string;
  suggestedFilename: string;
  startedAt: string;
  targetPath?: string;
}

export interface PendingNetworkRequest {
  url: string;
  method: string;
  loadingDurationMs: number;
  resourceType: string;
}

export interface SearchPageParams {
  pattern: string;
  regex?: boolean;
  caseSensitive?: boolean;
  contextChars?: number;
  cssScope?: string;
  maxResults?: number;
}

export interface FindElementsParams {
  selector: string;
  attributes?: string[];
  maxResults?: number;
  includeText?: boolean;
}

export type NavigationHealthStatus = "loaded" | "timeout" | "empty" | "cdp_error";

export interface NavigationHealthResult {
  ok: boolean;
  status: NavigationHealthStatus;
  url: string;
  finalUrl?: string;
  readyState?: string;
  durationMs: number;
  warning?: string;
}

export interface ExtractContentParams {
  query: string;
  extractLinks?: boolean;
  extractImages?: boolean;
  startFromChar?: number;
  maxChars?: number;
  /** Canonical identifiers already collected; deduped against new links. */
  alreadyCollected?: string[];
}

export interface ExtractContentResult {
  url: string;
  query: string;
  content: string;
  stats: {
    totalChars: number;
    startFromChar: number;
    returnedChars: number;
    truncated: boolean;
    nextStartChar: number | null;
    linksCount: number;
    imagesCount: number;
  };
}

export interface RuntimeExceptionDetails {
  text?: string;
  lineNumber?: number;
  columnNumber?: number;
  exception?: { description?: string; value?: unknown };
}
