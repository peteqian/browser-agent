import type { AgentEvent, OnEventCallback } from "../agent/contracts";

export function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

export function jsonResult(value: unknown) {
  return textResult(typeof value === "string" ? value : JSON.stringify(value));
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
