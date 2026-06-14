import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { AgentEvent } from "./contracts";

/**
 * Records an agent run to disk as a replayable bundle: one screenshot +
 * observation + decision + action-result per step, plus a self-contained
 * `index.html` timeline. When a job-application run fails in CI, open the
 * HTML to see exactly what the agent saw and did at each step — no live
 * browser needed.
 *
 * Wire via `onEvent`:
 *   const tracer = new TraceRecorder({ dir: "./traces/run-1" });
 *   await runTask({ ..., onEvent: tracer.onEvent });
 *   tracer.finalize();
 */
export interface TraceRecorderOptions {
  dir: string;
  /** Persist screenshots (base64 PNG → file). Default: true. */
  screenshots?: boolean;
  /**
   * Injected fs hooks for testing. Default to node:fs.
   */
  fs?: {
    mkdirSync: (path: string, opts: { recursive: true }) => void;
    writeFileSync: (path: string, data: string | Buffer) => void;
  };
}

interface TraceStep {
  step: number;
  url?: string;
  observation?: string;
  screenshotFile?: string;
  thought?: string;
  actions: Array<{ name: string; ok?: boolean; message?: string; params?: unknown }>;
}

export interface TraceManifest {
  startedAt: string;
  finishedAt?: string;
  result?: { success: boolean; reason: string; summary: string } | null;
  steps: TraceStep[];
}

export class TraceRecorder {
  readonly onEvent = (event: AgentEvent<unknown>): void => this.handleEvent(event);

  private readonly dir: string;
  private readonly screenshots: boolean;
  private readonly fsImpl: NonNullable<TraceRecorderOptions["fs"]>;
  private readonly steps = new Map<number, TraceStep>();
  private readonly startedAt = new Date().toISOString();
  private finishedAt?: string;
  private result: TraceManifest["result"] = null;
  private dirReady = false;

  constructor(options: TraceRecorderOptions) {
    this.dir = options.dir;
    this.screenshots = options.screenshots ?? true;
    this.fsImpl = options.fs ?? { mkdirSync, writeFileSync };
  }

  private ensureDir(): void {
    if (this.dirReady) return;
    this.fsImpl.mkdirSync(this.dir, { recursive: true });
    this.dirReady = true;
  }

  handleEvent(event: AgentEvent<unknown>): void {
    switch (event.type) {
      case "browser_state":
        this.step(event.step).url = event.state.url;
        this.step(event.step).observation = event.state.observation;
        break;
      case "screenshot": {
        if (!this.screenshots) break;
        this.ensureDir();
        const file = `step-${event.step}.png`;
        try {
          this.fsImpl.writeFileSync(
            join(this.dir, file),
            Buffer.from(event.screenshot.base64, "base64"),
          );
          this.step(event.step).screenshotFile = file;
        } catch {
          // Screenshot persistence is best-effort.
        }
        break;
      }
      case "decision":
        this.step(event.step).thought = event.decision.thought;
        for (const action of event.decision.actions ?? []) {
          this.step(event.step).actions.push({ name: action.name, params: action.params });
        }
        break;
      case "action": {
        const actions = this.step(event.step).actions;
        const match = actions.findLast((a) => a.name === event.action.name && a.ok === undefined);
        const target = match ?? { name: event.action.name };
        target.ok = event.result.ok;
        target.message = event.result.message;
        if (!match) actions.push(target);
        break;
      }
      case "terminal":
        this.finishedAt = new Date().toISOString();
        this.result = event.result
          ? {
              success: event.result.success,
              reason: event.result.reason,
              summary: event.result.summary,
            }
          : null;
        break;
      default:
        break;
    }
  }

  manifest(): TraceManifest {
    return {
      startedAt: this.startedAt,
      ...(this.finishedAt ? { finishedAt: this.finishedAt } : {}),
      result: this.result,
      steps: [...this.steps.values()].toSorted((a, b) => a.step - b.step),
    };
  }

  /** Write `trace.json` + `index.html`. Call once after the run. */
  finalize(): void {
    this.ensureDir();
    const manifest = this.manifest();
    this.fsImpl.writeFileSync(join(this.dir, "trace.json"), JSON.stringify(manifest, null, 2));
    this.fsImpl.writeFileSync(join(this.dir, "index.html"), renderTimelineHtml(manifest));
  }

  private step(index: number): TraceStep {
    let step = this.steps.get(index);
    if (!step) {
      step = { step: index, actions: [] };
      this.steps.set(index, step);
    }
    return step;
  }
}

function esc(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function renderTimelineHtml(manifest: TraceManifest): string {
  const status = manifest.result
    ? `${manifest.result.success ? "✅" : "❌"} ${esc(manifest.result.reason)} — ${esc(manifest.result.summary)}`
    : "⏳ no terminal result";
  const stepsHtml = manifest.steps
    .map((step) => {
      const shot = step.screenshotFile
        ? `<img src="${esc(step.screenshotFile)}" loading="lazy" alt="step ${step.step}">`
        : `<div class="noshot">no screenshot</div>`;
      const actions = step.actions
        .map(
          (a) =>
            `<li class="${a.ok === false ? "fail" : a.ok ? "ok" : ""}"><code>${esc(a.name)}</code>${
              a.message ? ` — ${esc(a.message)}` : ""
            }</li>`,
        )
        .join("");
      return `<section class="step">
  <h2>Step ${step.step}</h2>
  <div class="url">${esc(step.url ?? "")}</div>
  ${shot}
  ${step.thought ? `<p class="thought">${esc(step.thought)}</p>` : ""}
  <ul class="actions">${actions}</ul>
  <details><summary>Observation</summary><pre>${esc(step.observation ?? "")}</pre></details>
</section>`;
    })
    .join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>browser-agent trace</title>
<style>
body{font:14px system-ui,sans-serif;margin:0;background:#0f1115;color:#e6e6e6}
header{padding:16px 24px;background:#171a21;position:sticky;top:0}
.step{padding:16px 24px;border-bottom:1px solid #232733}
.url{color:#7aa2f7;font-size:12px;margin-bottom:8px;word-break:break-all}
img{max-width:100%;border:1px solid #232733;border-radius:6px}
.noshot{color:#666;font-style:italic}
.thought{color:#c0caf5}
.actions{list-style:none;padding:0}
.actions li{padding:2px 0}
.actions .ok code{color:#9ece6a}
.actions .fail code{color:#f7768e}
.actions code{background:#1f2330;padding:1px 6px;border-radius:4px}
pre{white-space:pre-wrap;background:#1a1d26;padding:12px;border-radius:6px;max-height:320px;overflow:auto}
</style></head>
<body>
<header><h1>browser-agent trace</h1><div>${status}</div><div style="color:#888;font-size:12px">${esc(manifest.startedAt)} → ${esc(manifest.finishedAt ?? "—")}</div></header>
${stepsHtml}
</body></html>`;
}
