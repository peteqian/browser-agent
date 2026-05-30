/**
 * Codex SDK example.
 *
 * Uses `createCodexSdkDecide` directly. Requires either OPENAI_API_KEY or a
 * logged-in `codex` CLI (~/.codex/auth.json).
 *
 * Run:
 *   bun run examples/codex-sdk.ts "your task here"
 */
import { createCodexSdkDecide, runTask } from "../src/index";

const task =
  process.argv[2] ??
  "Go to https://example.com and report the H1 text via done(success=true, summary=...).";

const decide = createCodexSdkDecide({
  model: "gpt-5.3-codex",
  effort: "medium",
  apiKey: process.env.OPENAI_API_KEY,
  onRaw: (raw, step) => {
    // Useful for debugging unexpected model output.
    if (process.env.DEBUG_RAW) console.error(`[step ${step}] raw:`, raw);
  },
});

const result = await runTask({
  task,
  startUrl: "about:blank",
  launch: { headless: true },
  getNextAction: decide,
  onEvent: (event) => {
    if (event.type === "decision") {
      const action = event.decision.actions[0];
      const usage = event.decision.telemetry?.usage;
      const tokens = usage ? ` [tokens in/out=${usage.inputTokens}/${usage.outputTokens}]` : "";
      console.log(`[${event.step}] decided ${action?.name}${tokens}`);
    } else if (event.type === "action") {
      console.log(`        -> ${event.result.ok ? "ok" : "FAIL"}: ${event.result.message}`);
    }
  },
});

console.log("\nRESULT:", JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
