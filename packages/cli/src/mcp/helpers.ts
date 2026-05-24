import { type AgentEvent, type OnEventCallback } from "@peteqian/browser-agent-sdk";
import {
  createDefaultActionRegistry,
  SessionRunner,
  type Action,
  type ActionResult,
} from "@peteqian/browser-agent-sdk/internal";
import {
  recordArtifact,
  recordSessionEvent,
  type ArtifactKind,
  type SessionRecord,
} from "./sessions";

const actionRegistry = createDefaultActionRegistry();
const domBudgets = { maxDisplayElements: 100, maxTotalChars: 12_000 };

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
  const runner = sessionRunner(record);
  const state = await runner.refresh({ previousUrl: options.previousUrl });
  syncRecord(record, runner);
  return state;
}

async function currentUrl(record: SessionRecord): Promise<string | undefined> {
  return sessionRunner(record).currentUrl();
}

export async function runSessionAction(
  record: SessionRecord,
  action: Action,
  options: { observe?: boolean; sessionId?: string } = {},
) {
  const previousUrl = await currentUrl(record);
  const startedAt = Date.now();
  const runner = sessionRunner(record);
  const result = await runner.runAction(action);
  syncRecord(record, runner);
  recordActionArtifact(record, action.name, result);
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
  const runner = sessionRunner(record);
  const results: ActionResult[] = [];
  await runner.runActions(actions, {
    stopOnFailure: true,
    onAction: async ({ action, result, page, durationMs }) => {
      results.push(result);
      recordActionArtifact(record, action.name, result);
      recordSessionEvent(
        record,
        {
          kind: "action",
          name: action.name,
          ok: result.ok,
          message: result.message,
          durationMs,
          url: await readPageUrl(page),
        },
        options.sessionId,
      );
    },
  });
  syncRecord(record, runner);
  return actionResult(
    record,
    { ok: results.every((result) => result.ok), results },
    {
      ...options,
      previousUrl,
    },
  );
}

function sessionRunner(record: SessionRecord): SessionRunner {
  if (!record.runner) {
    record.runner = new SessionRunner({
      session: record.session,
      page: record.page,
      actionRegistry,
      latestState: record.latestState,
      allowedDomains: record.allowedDomains,
      domBudgets,
    });
  }
  return record.runner;
}

function syncRecord(record: SessionRecord, runner: SessionRunner): void {
  record.page = runner.page;
  record.latestState = runner.latestState;
}

async function readPageUrl(page: SessionRecord["page"]): Promise<string | undefined> {
  try {
    return await page.currentUrl();
  } catch {
    return undefined;
  }
}

function recordActionArtifact(
  record: SessionRecord,
  actionName: string,
  result: ActionResult,
): void {
  const kind = artifactKindForAction(actionName);
  if (!kind) return;
  recordArtifact(record, kind, result);
}

function artifactKindForAction(actionName: string): ArtifactKind | undefined {
  if (actionName === "screenshot") return "screenshot";
  if (actionName === "save_as_pdf") return "pdf";
  return undefined;
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
          ...(message ? { message } : {}),
        },
      });
    } catch {
      // Best-effort. Broken progress channel must not abort the agent run.
    }
  };
}
