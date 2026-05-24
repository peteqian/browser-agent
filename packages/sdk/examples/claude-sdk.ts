/**
 * Claude Agent SDK example.
 *
 * Uses `createClaudeSdkDecide` directly. Requires either ANTHROPIC_API_KEY
 * or a logged-in `claude` CLI (~/.claude/.credentials.json).
 *
 * Run:
 *   bun run examples/claude-sdk.ts "your task here"
 */
import { createClaudeSdkDecide, runTask } from "../src/index";

const task =
  process.argv[2] ??
  "Go to https://example.com and report the H1 text via done(success=true, summary=...).";

const decide = createClaudeSdkDecide({
  model: "claude-sonnet-4-5",
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const result = await runTask({
  task,
  startUrl: "about:blank",
  launch: { headless: true },
  getNextAction: decide,
  onEvent: (event) => {
    if (event.type === "decision") {
      const action = event.decision.actions[0];
      console.log(`[${event.step}] decided ${action?.name}(${JSON.stringify(action?.params)})`);
    } else if (event.type === "action") {
      console.log(`        -> ${event.result.ok ? "ok" : "FAIL"}: ${event.result.message}`);
    }
  },
});

console.log("\nRESULT:", JSON.stringify(result, null, 2));
process.exit(result.success ? 0 : 1);
