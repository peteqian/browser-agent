import { Browser, runTask } from "../../src/index";
import type { BenchTask } from "./types";

export interface HarnessRunResult {
  reason: string;
  summary: string;
  steps: number;
  duration_ms: number;
  trajectory: string;
  error?: string;
}

export async function runPeteqianAgent(
  task: BenchTask,
  options: { model?: string; provider?: string; headless?: boolean } = {},
): Promise<HarnessRunResult> {
  const browser = new Browser();
  const started = Date.now();

  const trajectory: string[] = [];

  try {
    const result = await runTask({
      task: task.confirmed_task,
      browser,
      startUrl: "about:blank",
      headless: options.headless ?? true,
      ...(options.provider
        ? { llm: { provider: options.provider as never, model: options.model } }
        : {}),
      onEvent: (event) => {
        if (event.type === "decision") {
          const d = event.decision;
          const parts: string[] = [`step ${event.step} done=${d.done}`];
          if (d.summary) parts.push(`summary=${d.summary}`);
          if (d.thought) parts.push(`thought=${d.thought.slice(0, 200)}`);
          if (d.nextGoal) parts.push(`goal=${d.nextGoal}`);
          if (d.memory) parts.push(`memory=${d.memory.slice(0, 200)}`);
          trajectory.push(parts.join(" | "));
        } else if (event.type === "action") {
          const a = event.action as { name?: string; params?: unknown };
          const paramStr = a.params ? JSON.stringify(a.params).slice(0, 160) : "";
          trajectory.push(
            `step ${event.step} action=${a.name ?? "?"} params=${paramStr} url=${event.url} ok=${event.result.ok} msg=${event.result.message?.slice(0, 200)}`,
          );
        }
      },
    });

    return {
      reason: result.reason,
      summary: result.summary ?? "",
      steps: result.steps,
      duration_ms: Date.now() - started,
      trajectory: trajectory.join("\n"),
    };
  } catch (error) {
    return {
      reason: "harness_error",
      summary: "",
      steps: 0,
      duration_ms: Date.now() - started,
      trajectory: trajectory.join("\n"),
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await browser.close().catch(() => {});
  }
}
