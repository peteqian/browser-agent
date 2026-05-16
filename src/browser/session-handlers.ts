import type { CDPClient } from "../cdp/client";
import type { BrowserSession } from "./session";
import { createJavaScriptDialogWatchdogData, safeDownloadPath } from "./session-helpers";
import type {
  AttachedTargetEvent,
  DetachedTargetEvent,
  DownloadInfo,
  DownloadProgressEvent,
  DownloadWillBeginEvent,
  JavascriptDialogOpeningEvent,
} from "./session-types";

/**
 * Wire all CDP event handlers (downloads, target attach/detach, dialogs) onto
 * a fresh client. Kept separate from BrowserSession.connect so the handler
 * surface is auditable in isolation.
 */
export function wireCdpHandlers(client: CDPClient, session: BrowserSession): void {
  client.on("Browser.downloadWillBegin", (params) => {
    const event = params as DownloadWillBeginEvent;
    const info: DownloadInfo = {
      guid: event.guid,
      url: event.url,
      suggestedFilename: event.suggestedFilename,
      startedAt: new Date().toISOString(),
      ...(session.profile.downloadsDir
        ? { targetPath: safeDownloadPath(session.profile.downloadsDir, event.suggestedFilename) }
        : {}),
    };
    session.downloads.set(event.guid, info);
    void session.eventBus.emit({ type: "browser_event", name: "download_started", data: info });
  });

  client.on("Browser.downloadProgress", (params) => {
    const event = params as DownloadProgressEvent;
    const info = session.downloads.get(event.guid);
    const data = {
      guid: event.guid,
      state: event.state,
      totalBytes: event.totalBytes,
      receivedBytes: event.receivedBytes,
      url: info?.url,
      suggestedFilename: info?.suggestedFilename,
      path: event.filePath ?? info?.targetPath,
    };
    if (event.state === "inProgress") {
      void session.eventBus.emit({ type: "browser_event", name: "download_progress", data });
      return;
    }
    session.downloads.delete(event.guid);
    void session.eventBus.emit({
      type: "browser_event",
      name: event.state === "completed" ? "download_completed" : "download_failed",
      data,
    });
  });

  client.on("Target.attachedToTarget", (params) => {
    const event = params as AttachedTargetEvent;
    if (event.targetInfo.type !== "page") return;
    session.targetToSession.set(event.targetInfo.targetId, event.sessionId);
    session.sessionToTarget.set(event.sessionId, event.targetInfo.targetId);
    const enablePromise = session
      .enableDomainsForSession(event.sessionId)
      .then(() => {
        void session.eventBus.emit({
          type: "browser_event",
          name: "target_attached",
          targetId: event.targetInfo.targetId,
          data: event.targetInfo,
        });
      })
      .catch((error) => {
        session.targetToSession.delete(event.targetInfo.targetId);
        session.sessionToTarget.delete(event.sessionId);
        if (session.intentionalStop) return;
        void session.eventBus.emit({
          type: "browser_error",
          message: "Failed to enable page domains",
          targetId: event.targetInfo.targetId,
          error,
        });
      })
      .finally(() => {
        session.targetEnablePromises.delete(event.targetInfo.targetId);
      });
    session.targetEnablePromises.set(event.targetInfo.targetId, enablePromise);
  });

  client.on("Target.detachedFromTarget", (params) => {
    const event = params as DetachedTargetEvent;
    session.sessionToTarget.delete(event.sessionId);
    session.targetToSession.delete(event.targetId);
    session.targetEnablePromises.delete(event.targetId);
    void session.eventBus.emit({
      type: "browser_event",
      name: "target_detached",
      targetId: event.targetId,
      data: event,
    });
  });

  client.on("Page.javascriptDialogOpening", async (params, sessionId) => {
    if (!sessionId) return;
    const event = (params ?? {}) as JavascriptDialogOpeningEvent;
    const targetId = session.sessionToTarget.get(sessionId);
    const data = createJavaScriptDialogWatchdogData(event);
    try {
      await client.send("Page.handleJavaScriptDialog", { accept: data.accepted }, sessionId);
    } catch {
      // ignore dialog handling errors
    }
    void session.eventBus.emit({
      type: "browser_event",
      name: "javascript_dialog",
      targetId,
      data,
    });
  });
}
