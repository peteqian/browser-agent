import type { Page } from "../../browser/page/page";
import type { Action } from "../types";
import { fail, ok, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

const MAX_ENTRIES = 1_000;
const MAX_TEXT_PER_ENTRY = 2_000;

export type ConsoleLevel = "log" | "info" | "warning" | "error" | "debug" | "exception";

export interface ConsoleEntry {
  level: ConsoleLevel;
  text: string;
  url?: string;
  lineNumber?: number;
  timestamp: number;
}

interface ConsoleRecorder {
  unsubscribers: Array<() => void>;
  entries: ConsoleEntry[];
}

const recorderByTarget = new WeakMap<Page, ConsoleRecorder>();

interface ConsoleAPICalled {
  type: string;
  args: Array<{ value?: unknown; description?: string; type?: string }>;
  stackTrace?: { callFrames: Array<{ url?: string; lineNumber?: number }> };
  timestamp: number;
}

interface ExceptionThrown {
  exceptionDetails: {
    text?: string;
    url?: string;
    lineNumber?: number;
    exception?: { description?: string; value?: unknown };
  };
  timestamp: number;
}

function normalizeLevel(raw: string): ConsoleLevel {
  switch (raw) {
    case "log":
    case "info":
    case "warning":
    case "error":
    case "debug":
    case "exception":
      return raw;
    case "warn":
      return "warning";
    default:
      return "log";
  }
}

function argToString(
  arg: { value?: unknown; description?: string; type?: string } | undefined,
): string {
  if (!arg) return "";
  if (arg.description) return String(arg.description);
  if (arg.value === undefined) return "undefined";
  if (typeof arg.value === "string") return arg.value;
  try {
    return JSON.stringify(arg.value);
  } catch {
    return String(arg.value);
  }
}

function pushBounded(recorder: ConsoleRecorder, entry: ConsoleEntry): void {
  recorder.entries.push({
    ...entry,
    text:
      entry.text.length > MAX_TEXT_PER_ENTRY ? entry.text.slice(0, MAX_TEXT_PER_ENTRY) : entry.text,
  });
  if (recorder.entries.length > MAX_ENTRIES) {
    recorder.entries.splice(0, recorder.entries.length - MAX_ENTRIES);
  }
}

export async function handleConsoleStart(
  ctx: HandlerContext,
  _action: ByName<"console_start">,
): Promise<ActionResult> {
  if (recorderByTarget.has(ctx.page)) {
    return ok("Console capture already in progress");
  }
  const recorder: ConsoleRecorder = { unsubscribers: [], entries: [] };
  recorder.unsubscribers.push(
    await ctx.page.session.onTargetEvent<ConsoleAPICalled>(
      ctx.page.targetId,
      "Runtime.consoleAPICalled",
      (p) => {
        const frame = p.stackTrace?.callFrames?.[0];
        pushBounded(recorder, {
          level: normalizeLevel(p.type),
          text: p.args.map(argToString).join(" "),
          url: frame?.url,
          lineNumber: frame?.lineNumber,
          timestamp: p.timestamp,
        });
      },
    ),
  );
  recorder.unsubscribers.push(
    await ctx.page.session.onTargetEvent<ExceptionThrown>(
      ctx.page.targetId,
      "Runtime.exceptionThrown",
      (p) => {
        const d = p.exceptionDetails;
        pushBounded(recorder, {
          level: "exception",
          text: d.exception?.description ?? d.text ?? "Uncaught exception",
          url: d.url,
          lineNumber: d.lineNumber,
          timestamp: p.timestamp,
        });
      },
    ),
  );
  recorderByTarget.set(ctx.page, recorder);
  return ok("Console capture started", { longTermMemory: "Started console capture" });
}

export function handleConsoleRead(
  ctx: HandlerContext,
  action: ByName<"console_read">,
): ActionResult {
  const recorder = recorderByTarget.get(ctx.page);
  if (!recorder) {
    return fail("No console capture in progress; call console_start first");
  }
  const want = action.params.level ? normalizeLevel(action.params.level) : undefined;
  const filtered = want
    ? recorder.entries.filter((e) => e.level === want)
    : recorder.entries.slice();
  const max = action.params.maxResults ?? 100;
  const sliced = filtered.slice(-max);
  if (action.params.clear) recorder.entries.length = 0;
  return ok(`Read ${sliced.length}/${filtered.length} console entries`, {
    longTermMemory: `Read ${sliced.length} console entries`,
    data: { total: filtered.length, entries: sliced },
  });
}

export function handleConsoleStop(
  ctx: HandlerContext,
  _action: ByName<"console_stop">,
): ActionResult {
  const recorder = recorderByTarget.get(ctx.page);
  if (!recorder) return fail("No console capture in progress");
  for (const u of recorder.unsubscribers) {
    try {
      u();
    } catch {
      // ignore
    }
  }
  recorderByTarget.delete(ctx.page);
  return ok(`Console capture stopped (${recorder.entries.length} entries captured)`, {
    longTermMemory: `Stopped console capture (${recorder.entries.length} entries)`,
    data: { totalCaptured: recorder.entries.length },
  });
}
