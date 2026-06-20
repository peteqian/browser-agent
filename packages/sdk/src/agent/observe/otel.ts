import type { RunReport, RunReportStep } from "./report";

/**
 * Dependency-free OpenTelemetry bridge. A RunReport already aggregates the
 * event stream; this maps it into generic OTel-shaped spans + metrics so a
 * consumer can forward them to any backend (Datadog, Grafana Tempo,
 * Honeycomb) without this package depending on `@opentelemetry/*`.
 *
 * The span tree mirrors the run: one root `browser_agent.run` span, a
 * `browser_agent.step` span per step, and child `decision` / `action` spans.
 * IDs are deterministic (derived from the run start time + an index) so the
 * same report always produces the same trace — handy for tests and dedupe.
 */

export type OtelSpanStatus = "ok" | "error" | "unset";

export interface OtelSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  /** Epoch nanoseconds (OTel's native unit). */
  startTimeUnixNano: number;
  endTimeUnixNano: number;
  attributes: Record<string, string | number | boolean>;
  status: OtelSpanStatus;
}

export interface OtelMetric {
  name: string;
  /** OTel metric kind; everything here is a non-monotonic gauge or counter. */
  kind: "counter" | "gauge";
  value: number;
  unit?: string;
  attributes?: Record<string, string | number | boolean>;
}

export interface OtelExport {
  resource: Record<string, string | number | boolean>;
  spans: OtelSpan[];
  metrics: OtelMetric[];
}

const MS_TO_NANO = 1_000_000;

function hex(value: number, bytes: number): string {
  const width = bytes * 2;
  // Mix the value so small sequential indices don't all share a long zero
  // prefix (some backends reject all-zero IDs).
  const mixed = (value * 0x9e3779b1) >>> 0;
  return (mixed.toString(16) + "0".repeat(width)).slice(0, width);
}

function statusFor(ok: boolean): OtelSpanStatus {
  return ok ? "ok" : "error";
}

/**
 * Convert a RunReport to OTel spans + metrics. Span timing is reconstructed
 * from per-step/per-action durations laid end-to-end within the run window —
 * the report does not carry absolute per-action timestamps, so child spans are
 * sequenced, not wall-clock-precise. Totals (run duration, tokens, cost) are
 * exact.
 */
export function reportToOtel(report: RunReport): OtelExport {
  const traceId = hex(Date.parse(report.startedAt) || 1, 16);
  const runStartNano = (Date.parse(report.startedAt) || 0) * MS_TO_NANO;
  const runEndNano = (Date.parse(report.finishedAt) || 0) * MS_TO_NANO;
  const rootSpanId = hex(1, 8);
  let spanCounter = 2;
  const nextSpanId = () => hex(spanCounter++, 8);

  const spans: OtelSpan[] = [
    {
      traceId,
      spanId: rootSpanId,
      name: "browser_agent.run",
      startTimeUnixNano: runStartNano,
      endTimeUnixNano: runEndNano,
      attributes: {
        task: report.task,
        ...(report.provider ? { provider: report.provider } : {}),
        ...(report.transport ? { transport: report.transport } : {}),
        ...(report.model ? { model: report.model } : {}),
        "result.reason": report.result?.reason ?? "none",
        steps: report.result?.steps ?? report.steps.length,
        "tokens.input": report.usage.inputTokens,
        "tokens.output": report.usage.outputTokens,
        ...(report.costUsd !== null ? { "cost.usd": report.costUsd } : {}),
      },
      status: statusFor(report.result?.success ?? false),
    },
  ];

  let cursorNano = runStartNano;
  for (const step of report.steps) {
    const stepStart = cursorNano;
    const stepDuration = stepDurationNano(step);
    const stepEnd = stepStart + stepDuration;
    cursorNano = stepEnd;
    const stepSpanId = nextSpanId();
    const stepOk = step.actions.length === 0 || step.actions.every((a) => a.ok);
    spans.push({
      traceId,
      spanId: stepSpanId,
      parentSpanId: rootSpanId,
      name: "browser_agent.step",
      startTimeUnixNano: stepStart,
      endTimeUnixNano: stepEnd,
      attributes: { step: step.step, actions: step.actions.length },
      status: statusFor(stepOk),
    });

    let childCursor = stepStart;
    if (step.snapshot) {
      const dur = step.snapshot.durationMs * MS_TO_NANO;
      spans.push({
        traceId,
        spanId: nextSpanId(),
        parentSpanId: stepSpanId,
        name: "browser_agent.snapshot",
        startTimeUnixNano: childCursor,
        endTimeUnixNano: childCursor + dur,
        attributes: {
          "elements.count": step.snapshot.elementCount,
          "observation.bytes": step.snapshot.bytes,
        },
        status: "ok",
      });
      childCursor += dur;
    }
    if (step.decision) {
      const dur = step.decision.durationMs * MS_TO_NANO;
      spans.push({
        traceId,
        spanId: nextSpanId(),
        parentSpanId: stepSpanId,
        name: "browser_agent.decision",
        startTimeUnixNano: childCursor,
        endTimeUnixNano: childCursor + dur,
        attributes: {
          ...(step.decision.model ? { model: step.decision.model } : {}),
          "tokens.input": step.decision.inputTokens ?? 0,
          "tokens.output": step.decision.outputTokens ?? 0,
          ...(step.decision.costUsd !== undefined ? { "cost.usd": step.decision.costUsd } : {}),
        },
        status: "ok",
      });
      childCursor += dur;
    }
    for (const action of step.actions) {
      const dur = action.durationMs * MS_TO_NANO;
      spans.push({
        traceId,
        spanId: nextSpanId(),
        parentSpanId: stepSpanId,
        name: `action.${action.name}`,
        startTimeUnixNano: childCursor,
        endTimeUnixNano: childCursor + dur,
        attributes: {
          action: action.name,
          ...(action.message ? { message: action.message } : {}),
        },
        status: statusFor(action.ok),
      });
      childCursor += dur;
    }
  }

  const metrics: OtelMetric[] = [
    { name: "browser_agent.run.duration", kind: "gauge", value: report.durationMs, unit: "ms" },
    {
      name: "browser_agent.run.steps",
      kind: "gauge",
      value: report.result?.steps ?? report.steps.length,
    },
    {
      name: "browser_agent.tokens.input",
      kind: "counter",
      value: report.usage.inputTokens,
      unit: "{token}",
    },
    {
      name: "browser_agent.tokens.output",
      kind: "counter",
      value: report.usage.outputTokens,
      unit: "{token}",
    },
    {
      name: "browser_agent.tokens.cache_read",
      kind: "counter",
      value: report.usage.cacheReadTokens,
      unit: "{token}",
    },
    { name: "browser_agent.challenges", kind: "counter", value: report.challenges.length },
    { name: "browser_agent.loop_nudges", kind: "counter", value: report.loopNudges },
  ];
  if (report.costUsd !== null) {
    metrics.push({
      name: "browser_agent.cost",
      kind: "counter",
      value: report.costUsd,
      unit: "USD",
    });
  }

  return {
    resource: {
      "service.name": "browser-agent",
      ...(report.model ? { "llm.model": report.model } : {}),
      ...(report.provider ? { "llm.provider": report.provider } : {}),
    },
    spans,
    metrics,
  };
}

function stepDurationNano(step: RunReportStep): number {
  const snapshot = step.snapshot?.durationMs ?? 0;
  const decision = step.decision?.durationMs ?? 0;
  const actions = step.actions.reduce((sum, a) => sum + a.durationMs, 0);
  return Math.max(1, (snapshot + decision + actions) * MS_TO_NANO);
}
