import type { ChallengeEncounter } from "../browser/watchdogs/challenge";
import { estimateCostUsd, type ModelPricing } from "../llm/pricing";
import type { AgentEvent, AgentResult } from "./contracts";

/**
 * Machine-readable record of one agent run, built from the AgentEvent stream.
 * Stable shape intended for CI/CD consumption: archive the JSON as a build
 * artifact, gate on `result.success`, track `usage`/`costUsd` over time, or
 * publish `toJUnitXml()` where the CI system expects JUnit test reports.
 */
export interface RunReport {
  /** Report schema version — bump on breaking shape changes. */
  schemaVersion: 1;
  task: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  result: AgentResult<unknown> | null;
  provider?: string;
  transport?: string;
  /** Model from the last decision that reported one. */
  model?: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheCreationTokens: number;
  };
  /**
   * Estimated spend in USD. Null when no decision carried a priceable model.
   * When `costIsPartial` is true, some decisions had no pricing entry and the
   * figure undercounts.
   */
  costUsd: number | null;
  costIsPartial: boolean;
  steps: RunReportStep[];
  challenges: ChallengeEncounter[];
  loopNudges: number;
}

export interface RunReportStep {
  step: number;
  snapshot?: { durationMs: number; elementCount: number; bytes: number };
  decision?: {
    durationMs: number;
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheCreationTokens?: number;
    model?: string;
    costUsd?: number;
  };
  actions: Array<{ name: string; ok: boolean; durationMs: number; message?: string }>;
}

export interface RunReportCollectorOptions {
  task?: string;
  /** Custom price table merged over the built-in one. */
  pricing?: Record<string, ModelPricing>;
}

/**
 * Collects AgentEvents into a RunReport. Wire it up via the loop's onEvent:
 *
 *   const collector = new RunReportCollector({ task });
 *   const result = await runLoop({ ..., onEvent: collector.onEvent });
 *   writeFileSync("report.json", JSON.stringify(collector.build(), null, 2));
 */
export class RunReportCollector {
  readonly onEvent = (event: AgentEvent<unknown>): void => this.handleEvent(event);

  private readonly task: string;
  private readonly pricing?: Record<string, ModelPricing>;
  private readonly startedAtMs = Date.now();
  private finishedAtMs: number | null = null;
  private result: AgentResult<unknown> | null = null;
  private provider?: string;
  private transport?: string;
  private model?: string;
  private readonly usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
  };
  private costUsd: number | null = null;
  private costIsPartial = false;
  private readonly steps = new Map<number, RunReportStep>();
  private readonly challenges: ChallengeEncounter[] = [];
  private loopNudges = 0;
  /** Usage of the in-flight decision, priced once the decision event names the model. */
  private pendingDecisionStep: number | null = null;

  constructor(options: RunReportCollectorOptions = {}) {
    this.task = options.task ?? "";
    this.pricing = options.pricing;
  }

  handleEvent(event: AgentEvent<unknown>): void {
    switch (event.type) {
      case "transport_resolved":
        this.provider = event.resolution.provider;
        this.transport = event.resolution.transport;
        break;
      case "snapshot_captured":
        this.step(event.stepIndex).snapshot = {
          durationMs: event.durationMs,
          elementCount: event.elementCount,
          bytes: event.bytes,
        };
        break;
      case "decision_completed": {
        const step = this.step(event.stepIndex);
        step.decision = {
          durationMs: event.durationMs,
          inputTokens: event.tokensIn,
          outputTokens: event.tokensOut,
          cacheReadTokens: event.cacheReadTokens,
          cacheCreationTokens: event.cacheCreationTokens,
        };
        this.usage.inputTokens += event.tokensIn ?? 0;
        this.usage.outputTokens += event.tokensOut ?? 0;
        this.usage.cacheReadTokens += event.cacheReadTokens ?? 0;
        this.usage.cacheCreationTokens += event.cacheCreationTokens ?? 0;
        this.pendingDecisionStep = event.stepIndex;
        break;
      }
      case "decision": {
        // The decision event carries telemetry with the model — price the
        // usage recorded by the preceding decision_completed event.
        const model = event.decision.telemetry?.model;
        if (model) this.model = model;
        const stepIndex = this.pendingDecisionStep ?? event.step;
        const decision = this.steps.get(stepIndex)?.decision;
        this.pendingDecisionStep = null;
        if (!decision) break;
        if (model) decision.model = model;
        const cost = estimateCostUsd(
          {
            inputTokens: decision.inputTokens ?? 0,
            outputTokens: decision.outputTokens ?? 0,
            cachedInputTokens: decision.cacheReadTokens,
            cacheCreationTokens: decision.cacheCreationTokens,
          },
          model,
          this.pricing,
        );
        if (cost === null) {
          if ((decision.inputTokens ?? 0) + (decision.outputTokens ?? 0) > 0) {
            this.costIsPartial = true;
          }
        } else {
          decision.costUsd = cost;
          this.costUsd = (this.costUsd ?? 0) + cost;
        }
        break;
      }
      case "action_completed":
        this.step(event.stepIndex).actions.push({
          name: event.action,
          ok: event.ok,
          durationMs: event.durationMs,
        });
        break;
      case "action": {
        const actions = this.step(event.step).actions;
        const last = actions.findLast(
          (a) => a.name === event.action.name && a.message === undefined,
        );
        if (last) last.message = event.result.message;
        break;
      }
      case "challenge":
        this.challenges.push(event.encounter);
        break;
      case "loop_nudge":
        this.loopNudges = event.nudgesUsed;
        break;
      case "terminal":
        this.result = event.result;
        this.finishedAtMs = Date.now();
        break;
      default:
        break;
    }
  }

  build(): RunReport {
    const finishedAtMs = this.finishedAtMs ?? Date.now();
    return {
      schemaVersion: 1,
      task: this.task,
      startedAt: new Date(this.startedAtMs).toISOString(),
      finishedAt: new Date(finishedAtMs).toISOString(),
      durationMs: finishedAtMs - this.startedAtMs,
      result: this.result,
      ...(this.provider ? { provider: this.provider } : {}),
      ...(this.transport ? { transport: this.transport } : {}),
      ...(this.model ? { model: this.model } : {}),
      usage: { ...this.usage },
      costUsd: this.costUsd,
      costIsPartial: this.costIsPartial,
      steps: [...this.steps.values()].toSorted((a, b) => a.step - b.step),
      challenges: [...this.challenges],
      loopNudges: this.loopNudges,
    };
  }

  private step(index: number): RunReportStep {
    let step = this.steps.get(index);
    if (!step) {
      step = { step: index, actions: [] };
      this.steps.set(index, step);
    }
    return step;
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * Render a RunReport as a single-testcase JUnit XML document, the lingua
 * franca of CI test reporting (GitHub Actions, GitLab, Jenkins, Buildkite).
 */
export function toJUnitXml(report: RunReport): string {
  const name = report.task || "browser-agent run";
  const timeSec = (report.durationMs / 1000).toFixed(3);
  const failed = !report.result?.success;
  const failure = failed
    ? `\n    <failure message="${xmlEscape(report.result?.reason ?? "no_result")}">${xmlEscape(
        report.result?.summary ?? "Run produced no terminal result",
      )}</failure>`
    : "";
  const properties = [
    ["steps", String(report.result?.steps ?? report.steps.length)],
    ["inputTokens", String(report.usage.inputTokens)],
    ["outputTokens", String(report.usage.outputTokens)],
    ["costUsd", report.costUsd === null ? "unknown" : report.costUsd.toFixed(6)],
    ["challenges", String(report.challenges.length)],
    ...(report.model ? [["model", report.model] as const] : []),
  ]
    .map(
      ([key, value]) => `\n      <property name="${xmlEscape(key)}" value="${xmlEscape(value)}"/>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<testsuites tests="1" failures="${failed ? 1 : 0}" time="${timeSec}">
  <testsuite name="browser-agent" tests="1" failures="${failed ? 1 : 0}" time="${timeSec}">
    <properties>${properties}
    </properties>
    <testcase name="${xmlEscape(name)}" classname="browser-agent" time="${timeSec}">${failure}
    </testcase>
  </testsuite>
</testsuites>
`;
}
