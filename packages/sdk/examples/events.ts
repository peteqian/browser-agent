/**
 * Event-stream example.
 *
 * Demonstrates the full AgentEvent surface plus transport_resolved + token
 * aggregation. Uses `createDecide` so transport selection is automatic.
 *
 * Run:
 *   bun run examples/events.ts "your task here"
 */
import { createDecide, runTask, type AgentEvent } from "../src/index";

const task =
  process.argv[2] ??
  "Go to https://example.com and report the H1 text via done(success=true, summary=...).";

const provider = (process.env.PROVIDER ?? "codex") as "codex" | "claude" | "openai" | "anthropic";

const { decide, resolution } = createDecide({ provider });

let totalIn = 0;
let totalOut = 0;
let totalCached = 0;

function handle(event: AgentEvent): void {
  switch (event.type) {
    case "transport_resolved":
      console.log(
        `[transport] ${event.resolution.transport} (${event.resolution.provider}/${event.resolution.env})` +
          (event.resolution.fallbackFrom
            ? ` — fell back from ${event.resolution.fallbackFrom}: ${event.resolution.fallbackReason}`
            : ""),
      );
      break;

    case "decision": {
      const action = event.decision.actions[0];
      const usage = event.decision.telemetry?.usage;
      if (usage) {
        totalIn += usage.inputTokens;
        totalOut += usage.outputTokens;
        totalCached += usage.cachedInputTokens ?? 0;
      }
      console.log(
        `[step ${event.step}] decided ${action?.name}(${JSON.stringify(action?.params)})`,
      );
      break;
    }

    case "action":
      console.log(
        `[step ${event.step}] ${event.action.name}: ${event.result.ok ? "ok" : "FAILED"} — ${event.result.message}`,
      );
      break;

    case "terminal":
      console.log(
        "\n[terminal]",
        event.result.success ? "SUCCESS" : "FAILED",
        event.result.summary,
      );
      console.log(
        `[totals] inputTokens=${totalIn} outputTokens=${totalOut} cachedInputTokens=${totalCached} steps=${event.result.steps}`,
      );
      break;
  }
}

const result = await runTask({
  task,
  startUrl: "about:blank",
  launch: { headless: true },
  getNextAction: decide,
  transportResolution: resolution,
  onEvent: handle,
});

process.exit(result.success ? 0 : 1);
