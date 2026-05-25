import { runTask } from "../src/index";

const task =
  "Go to seek.com.au, search for senior software engineer in Sydney, open the first job result, and click Apply. Stop after the Apply click; do not submit any application form or personal information.";

const result = await runTask({
  task,
  transport: "cli",
  profile: "seek",
  headless: false,
  decisionTimeoutMs: 60_000,
  onEvent: (event) => {
    if (event.type === "snapshot_captured") {
      console.log(
        `[snapshot ${event.stepIndex}] ${event.elementCount} elements, ${event.bytes} bytes`,
      );
    } else if (event.type === "decision") {
      console.log(
        `[decision ${event.step}] ${event.decision.actions.map((action) => action.name).join(", ")}`,
      );
    } else if (event.type === "action") {
      console.log(`[action ${event.step}] ${event.action.name}: ${event.result.message}`);
    } else if (event.type === "terminal") {
      console.log(`[terminal] ${event.result.reason}: ${event.result.summary}`);
    }
  },
});

console.log(JSON.stringify(result, null, 2));
