import {
  captureBrowserState,
  type AgentEvent,
  type OnEventCallback,
} from "@peteqian/browser-agent-sdk";
import {
  executeAction,
  type Action,
  type ActionResult,
} from "@peteqian/browser-agent-sdk/internal";
import { recordSessionEvent, type SessionRecord } from "./sessions";

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function jsonResult(value: unknown) {
  return textResult(typeof value === "string" ? value : JSON.stringify(value));
}

export async function actionResult(
  record: SessionRecord,
  value: unknown,
  options: { observe?: boolean; previousUrl?: string } = {},
) {
  if (options.observe === false) return jsonResult(value);
  const state = await refreshSessionState(record, { previousUrl: options.previousUrl }).catch(
    () => undefined,
  );
  return jsonResult({
    result: value,
    ...(state
      ? {
          observation: state.observation,
          url: state.url,
          title: state.title,
          readyState: state.readyState,
          elements: state.elements.length,
        }
      : {}),
  });
}

export async function refreshSessionState(
  record: SessionRecord,
  options: { previousUrl?: string } = {},
) {
  let state = await captureActionState(record);
  let previousSnapshot = state;
  let waitedAfterUrlChange = false;
  for (
    let attempt = 0;
    shouldRetryState(state, previousSnapshot, options, waitedAfterUrlChange) && attempt < 8;
    attempt += 1
  ) {
    await record.page.waitForTimeout(500);
    if (options.previousUrl && state.url !== options.previousUrl) waitedAfterUrlChange = true;
    previousSnapshot = state;
    state = await captureActionState(record);
  }
  record.latestState = state;
  return state;
}

function captureActionState(record: SessionRecord) {
  return captureBrowserState(record.page, record.session, {
    domBudgets: { maxDisplayElements: 100, maxTotalChars: 12_000 },
  });
}

function shouldRetryState(
  state: Awaited<ReturnType<typeof captureActionState>>,
  previousSnapshot: Awaited<ReturnType<typeof captureActionState>>,
  options: { previousUrl?: string },
  waitedAfterUrlChange: boolean,
): boolean {
  if (state.elements.length === 0)
    return state.readyState === "loading" || state.title.length === 0;
  if (state.readyState === "loading") return true;
  if (!options.previousUrl || state.url === options.previousUrl) return false;
  if (!waitedAfterUrlChange) return true;
  return state.url !== previousSnapshot.url;
}

async function currentUrl(record: SessionRecord): Promise<string | undefined> {
  if (record.latestState?.url) return record.latestState.url;
  try {
    return await record.page.currentUrl();
  } catch {
    return undefined;
  }
}

export async function runSessionAction(
  record: SessionRecord,
  action: Action,
  options: { observe?: boolean; sessionId?: string } = {},
) {
  const previousUrl = await currentUrl(record);
  const startedAt = Date.now();
  const result = await executeSessionAction(record, action);
  recordSessionEvent(
    record,
    {
      kind: "action",
      name: action.name,
      ok: result.ok,
      message: result.message,
      durationMs: Date.now() - startedAt,
      url: await currentUrl(record),
    },
    options.sessionId,
  );
  return actionResult(record, result, { ...options, previousUrl });
}

export async function runSessionActions(
  record: SessionRecord,
  actions: readonly Action[],
  options: { observe?: boolean; sessionId?: string } = {},
) {
  const previousUrl = await currentUrl(record);
  const results: ActionResult[] = [];
  for (const action of actions) {
    const startedAt = Date.now();
    const result = await executeSessionAction(record, action);
    results.push(result);
    recordSessionEvent(
      record,
      {
        kind: "action",
        name: action.name,
        ok: result.ok,
        message: result.message,
        durationMs: Date.now() - startedAt,
        url: await currentUrl(record),
      },
      options.sessionId,
    );
    if (!result.ok) break;
  }
  return actionResult(
    record,
    { ok: results.every((result) => result.ok), results },
    {
      ...options,
      previousUrl,
    },
  );
}

async function executeSessionAction(record: SessionRecord, action: Action): Promise<ActionResult> {
  const result = await executeAction(
    record.page,
    action,
    record.session,
    undefined,
    record.latestState?.selectorMap,
    undefined,
    undefined,
    undefined,
    { snapshotElements: record.latestState?.elements },
  );
  applyActiveTarget(record, result);
  return result;
}

function applyActiveTarget(record: SessionRecord, result: ActionResult): void {
  if (!result.activeTargetId) return;
  record.page = record.session.getPage(result.activeTargetId);
  record.latestState = undefined;
}

export function indexFromRef(input: { index?: number; ref?: string }): number | undefined {
  if (typeof input.index === "number") return input.index;
  if (!input.ref) return undefined;
  const match = /^@?e(\d+)$/.exec(input.ref.trim());
  return match ? Number(match[1]) : undefined;
}

export interface ProgressCapableExtra {
  sendNotification: (notification: {
    method: "notifications/progress";
    params: {
      progressToken: string | number;
      progress: number;
      total?: number;
      message?: string;
    };
  }) => Promise<void>;
}

/**
 * Map AgentEvents to MCP progress notifications. Progress must be monotonic,
 * so we use the running step index — bumped 0.5 between decision and action
 * within the same step so clients see two updates per step.
 *
 * Errors from sendNotification are swallowed: progress is best-effort and
 * must not break the run.
 */
export function buildProgressForwarder(
  extra: ProgressCapableExtra,
  progressToken: string | number,
  total: number,
): OnEventCallback {
  let progress = 0;

  return async (event: AgentEvent) => {
    let message: string | undefined;
    if (event.type === "transport_resolved") {
      message = `transport=${event.resolution.transport} (${event.resolution.provider}/${event.resolution.env})`;
    } else if (event.type === "decision") {
      progress = Math.max(progress + 0.5, event.step);
      const action = event.decision.actions[0];
      message = action ? `step ${event.step}: decided ${action.name}` : `step ${event.step}`;
    } else if (event.type === "action") {
      progress += 0.5;
      message = `${event.action.name}: ${event.result.ok ? "ok" : "failed"}`;
    } else if (event.type === "terminal") {
      progress = total;
      message = event.result.success
        ? `done: ${event.result.summary ?? ""}`
        : `failed: ${event.result.reason}`;
    }

    try {
      await extra.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress,
          total,
          ...(message ? { message } : {}),
        },
      });
    } catch {
      // Best-effort. Broken progress channel must not abort the agent run.
    }
  };
}
