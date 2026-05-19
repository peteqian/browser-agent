import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { Page } from "../../browser/page";
import type { Action } from "../types";
import { fail, ok, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

const MAX_HAR_ENTRIES = 5_000;

interface HarEntry {
  request: {
    requestId: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    timestamp: number;
  };
  response?: {
    status: number;
    statusText?: string;
    headers: Record<string, string>;
    mimeType?: string;
    timestamp: number;
  };
  timing: {
    startedAt: number;
    completedAt?: number;
  };
}

interface NetworkRecorder {
  unsubscribers: Array<() => void>;
  entries: Map<string, HarEntry>;
  startedAt: number;
}

const recorderByTarget = new WeakMap<Page, NetworkRecorder>();

interface RequestWillBeSent {
  requestId: string;
  request: { method: string; url: string; headers: Record<string, string> };
  timestamp: number;
  wallTime?: number;
}

interface ResponseReceived {
  requestId: string;
  response: {
    status: number;
    statusText?: string;
    headers: Record<string, string>;
    mimeType?: string;
  };
  timestamp: number;
}

interface LoadingFinished {
  requestId: string;
  timestamp: number;
}

export async function handleNetworkHarStart(
  ctx: HandlerContext,
  _action: ByName<"network_har_start">,
): Promise<ActionResult> {
  if (recorderByTarget.has(ctx.page)) {
    return ok("Network HAR recording already in progress");
  }
  const recorder: NetworkRecorder = {
    unsubscribers: [],
    entries: new Map(),
    startedAt: Date.now(),
  };
  // Register subscribers BEFORE Network.enable so events fired between enable
  // and our first listener cannot slip past.
  recorder.unsubscribers.push(
    await ctx.page.session.onTargetEvent<RequestWillBeSent>(
      ctx.page.targetId,
      "Network.requestWillBeSent",
      (p) => {
        if (recorder.entries.size >= MAX_HAR_ENTRIES) return;
        recorder.entries.set(p.requestId, {
          request: {
            requestId: p.requestId,
            method: p.request.method,
            url: p.request.url,
            headers: p.request.headers,
            timestamp: p.timestamp,
          },
          timing: { startedAt: p.timestamp },
        });
      },
    ),
  );
  recorder.unsubscribers.push(
    await ctx.page.session.onTargetEvent<ResponseReceived>(
      ctx.page.targetId,
      "Network.responseReceived",
      (p) => {
        const entry = recorder.entries.get(p.requestId);
        if (!entry) return;
        entry.response = {
          status: p.response.status,
          statusText: p.response.statusText,
          headers: p.response.headers,
          mimeType: p.response.mimeType,
          timestamp: p.timestamp,
        };
      },
    ),
  );
  recorder.unsubscribers.push(
    await ctx.page.session.onTargetEvent<LoadingFinished>(
      ctx.page.targetId,
      "Network.loadingFinished",
      (p) => {
        const entry = recorder.entries.get(p.requestId);
        if (!entry) return;
        entry.timing.completedAt = p.timestamp;
      },
    ),
  );
  recorderByTarget.set(ctx.page, recorder);
  try {
    await ctx.page.sendCDP("Network.enable", {});
  } catch (err) {
    for (const unsub of recorder.unsubscribers) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    recorderByTarget.delete(ctx.page);
    const message = err instanceof Error ? err.message : String(err);
    return fail(`Failed to enable Network domain: ${message}`);
  }
  let url: string | undefined;
  try {
    url = await ctx.page.currentUrl();
  } catch {
    // url unavailable — leave undefined
  }
  return ok("Network HAR recording started", {
    longTermMemory: url ? `Started HAR recording on ${url}` : "Started HAR recording",
  });
}

export async function handleNetworkHarStop(
  ctx: HandlerContext,
  action: ByName<"network_har_stop">,
): Promise<ActionResult> {
  const recorder = recorderByTarget.get(ctx.page);
  if (!recorder) return fail("No HAR recording in progress");
  for (const unsub of recorder.unsubscribers) {
    try {
      unsub();
    } catch {
      // ignore
    }
  }
  recorderByTarget.delete(ctx.page);
  const har = {
    entries: Array.from(recorder.entries.values()),
    startedAt: recorder.startedAt,
    endedAt: Date.now(),
  };
  if (action.params.fileName) {
    // Restrict writes to cwd. Strip path separators so callers cannot escape
    // via "../" or absolute paths.
    const safeName =
      basename(action.params.fileName).replace(/[\\/:*?"<>|]/g, "_") || `har-${Date.now()}.json`;
    const finalName = safeName.toLowerCase().endsWith(".json") ? safeName : `${safeName}.json`;
    const path = join(process.cwd(), finalName);
    try {
      await writeFile(path, JSON.stringify(har, null, 2), "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(`Failed to write HAR file: ${message}`);
    }
    return ok(`HAR written to ${path} (${har.entries.length} entries)`, { data: { path } });
  }
  return ok(`HAR captured: ${har.entries.length} entries`, {
    longTermMemory: `Captured HAR with ${har.entries.length} entries`,
    data: { har },
  });
}
