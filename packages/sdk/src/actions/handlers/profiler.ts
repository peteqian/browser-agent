import { writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { Page } from "../../browser/page/page";
import type { Action } from "../types";
import { fail, ok, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

const DEFAULT_CATEGORIES: readonly string[] = [
  "devtools.timeline",
  "v8.execute",
  "blink",
  "blink.user_timing",
  "latencyInfo",
];

interface TraceEvent {
  // Chrome Trace Event Format — opaque to us; we just buffer.
  [key: string]: unknown;
}

interface DataCollectedPayload {
  value: TraceEvent[];
}

interface ProfilerRecording {
  traceEvents: TraceEvent[];
  unsubscribers: Array<() => void>;
  completion: Promise<void>;
  resolveCompletion: () => void;
}

const recorderByPage = new WeakMap<Page, ProfilerRecording>();

export async function handleProfilerStart(
  ctx: HandlerContext,
  action: ByName<"profiler_start">,
): Promise<ActionResult> {
  if (recorderByPage.has(ctx.page)) {
    return ok("Profiler tracing already in progress");
  }

  let resolveCompletion: () => void = () => {};
  const completion = new Promise<void>((resolve) => {
    resolveCompletion = resolve;
  });
  const recording: ProfilerRecording = {
    traceEvents: [],
    unsubscribers: [],
    completion,
    resolveCompletion,
  };

  recording.unsubscribers.push(
    await ctx.page.session.onTargetEvent<DataCollectedPayload>(
      ctx.page.targetId,
      "Tracing.dataCollected",
      (p) => {
        if (Array.isArray(p.value)) {
          for (const event of p.value) {
            recording.traceEvents.push(event);
          }
        }
      },
    ),
  );
  recording.unsubscribers.push(
    await ctx.page.session.onTargetEvent<unknown>(
      ctx.page.targetId,
      "Tracing.tracingComplete",
      () => {
        recording.resolveCompletion();
      },
    ),
  );

  const categories =
    action.params.categories && action.params.categories.length > 0
      ? action.params.categories
      : DEFAULT_CATEGORIES;
  recorderByPage.set(ctx.page, recording);
  try {
    await ctx.page.sendCDP("Tracing.start", {
      categories: categories.join(","),
      transferMode: "ReportEvents",
    });
  } catch (err) {
    for (const unsub of recording.unsubscribers) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    recorderByPage.delete(ctx.page);
    const message = err instanceof Error ? err.message : String(err);
    return fail(`Failed to start tracing: ${message}`);
  }

  return ok(`Profiler started (${categories.length} categories)`, {
    longTermMemory: `Started CDP tracing with categories: ${categories.join(",")}`,
  });
}

export async function handleProfilerStop(
  ctx: HandlerContext,
  action: ByName<"profiler_stop">,
): Promise<ActionResult> {
  const recording = recorderByPage.get(ctx.page);
  if (!recording) return fail("No profiler recording in progress");

  try {
    await ctx.page.sendCDP("Tracing.end", {});
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Make sure we still clean up subscribers so a retried start works.
    for (const unsub of recording.unsubscribers) {
      try {
        unsub();
      } catch {
        // ignore
      }
    }
    recorderByPage.delete(ctx.page);
    return fail(`Failed to stop tracing: ${message}`);
  }

  await recording.completion;
  for (const unsub of recording.unsubscribers) {
    try {
      unsub();
    } catch {
      // ignore
    }
  }
  recorderByPage.delete(ctx.page);

  const trace = {
    traceEvents: recording.traceEvents,
    metadata: {
      "clock-domain": process.platform === "linux" ? "LINUX_CLOCK_MONOTONIC" : undefined,
    },
  };

  if (action.params.fileName) {
    const safeName =
      basename(action.params.fileName).replace(/[\\/:*?"<>|]/g, "_") || `trace-${Date.now()}.json`;
    const finalName = safeName.toLowerCase().endsWith(".json") ? safeName : `${safeName}.json`;
    const path = join(process.cwd(), finalName);
    try {
      await writeFile(path, JSON.stringify(trace), "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(`Failed to write trace file: ${message}`);
    }
    return ok(`Trace written to ${path} (${trace.traceEvents.length} events)`, {
      data: { path, events: trace.traceEvents.length },
    });
  }

  return ok(`Trace captured: ${trace.traceEvents.length} events`, {
    longTermMemory: `Captured trace with ${trace.traceEvents.length} events`,
    data: { trace },
  });
}
