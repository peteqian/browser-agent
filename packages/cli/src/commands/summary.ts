import type { AgentEvent } from "@peteqian/browser-agent-sdk";

/** Per-step aggregated timings, derived from the AgentEvent stream. */
export interface StepSummary {
  step: number;
  decisionMs: number;
  snapshotMs: number;
  /** Sum of all action durations for the step. */
  actionMs: number;
  /** Last action name observed in the step. */
  action: string;
  /** Whether the last action of the step reported ok. */
  ok: boolean;
}

interface MutableStep {
  step: number;
  decisionMs: number;
  snapshotMs: number;
  actionMs: number;
  action: string;
  ok: boolean;
  hasAction: boolean;
}

export class SummaryCollector {
  private steps = new Map<number, MutableStep>();

  observe(event: AgentEvent): void {
    if (event.type === "decision_completed") {
      const entry = this.ensure(event.stepIndex);
      entry.decisionMs += event.durationMs;
      return;
    }
    if (event.type === "snapshot_captured") {
      const entry = this.ensure(event.stepIndex);
      entry.snapshotMs += event.durationMs;
      return;
    }
    if (event.type === "action_completed") {
      const entry = this.ensure(event.stepIndex);
      entry.actionMs += event.durationMs;
      entry.action = event.action;
      entry.ok = event.ok;
      entry.hasAction = true;
    }
  }

  snapshot(): StepSummary[] {
    return Array.from(this.steps.values())
      .toSorted((a, b) => a.step - b.step)
      .map((s) => ({
        step: s.step,
        decisionMs: s.decisionMs,
        snapshotMs: s.snapshotMs,
        actionMs: s.actionMs,
        action: s.hasAction ? s.action : "(no action)",
        ok: s.hasAction ? s.ok : true,
      }));
  }

  private ensure(step: number): MutableStep {
    let entry = this.steps.get(step);
    if (!entry) {
      entry = {
        step,
        decisionMs: 0,
        snapshotMs: 0,
        actionMs: 0,
        action: "",
        ok: true,
        hasAction: false,
      };
      this.steps.set(step, entry);
    }
    return entry;
  }
}

function fmtMs(ms: number): string {
  return `${ms}ms`;
}

function fmtSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

function pad(value: string, width: number): string {
  if (value.length >= width) return value;
  return value + " ".repeat(width - value.length);
}

/** Renders an ASCII summary table for the given step list. */
export function renderSummary(steps: readonly StepSummary[]): string {
  const headers = ["step", "decision", "snapshot", "action", "total", "status"];
  const rows = steps.map((s) => {
    const total = s.decisionMs + s.snapshotMs + s.actionMs;
    return [
      String(s.step),
      fmtMs(s.decisionMs),
      fmtMs(s.snapshotMs),
      s.action,
      fmtMs(total),
      s.ok ? "ok" : "fail",
    ];
  });

  const widths = headers.map((h, i) => {
    let w = h.length;
    for (const row of rows) {
      const cell = row[i] ?? "";
      if (cell.length > w) w = cell.length;
    }
    return w;
  });

  const renderRow = (cells: readonly string[]): string =>
    cells.map((c, i) => pad(c, widths[i] ?? 0)).join("  ");

  const lines: string[] = [];
  lines.push(renderRow(headers));
  for (const row of rows) lines.push(renderRow(row));

  const totalDecision = steps.reduce((acc, s) => acc + s.decisionMs, 0);
  const totalSnapshot = steps.reduce((acc, s) => acc + s.snapshotMs, 0);
  const totalAction = steps.reduce((acc, s) => acc + s.actionMs, 0);
  const total = totalDecision + totalSnapshot + totalAction;

  const pct = (part: number): string =>
    total === 0 ? "0%" : `${Math.round((part / total) * 100)}%`;

  const divider = "─".repeat(Math.max(0, lines[0]?.length ?? 40));
  lines.push(divider);
  lines.push(
    `Total: ${fmtSeconds(total)} · ${steps.length} steps · LLM ${fmtSeconds(
      totalDecision,
    )} (${pct(totalDecision)}) · snapshot ${fmtSeconds(totalSnapshot)} (${pct(
      totalSnapshot,
    )}) · action ${fmtSeconds(totalAction)} (${pct(totalAction)})`,
  );
  return lines.join("\n");
}
