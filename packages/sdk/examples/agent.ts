import { createCodexCliDecide, runTask } from "../src/index";

const task =
  process.argv[2] ?? "Go to https://example.com and report the H1 text via done(data=...).";

const result = await runTask({
  task,
  startUrl: "about:blank",
  launch: { headless: true },
  getNextAction: createCodexCliDecide({ model: "gpt-5.3-codex" }),
  onStep: (step) => {
    const summary = step.action.name === "done" ? "" : ` -> ${step.result.message}`;
    console.log(
      `[${step.step}] ${step.action.name}(${JSON.stringify(step.action.params)})${summary}`,
    );
  },
});

console.log("RESULT:", JSON.stringify(result, null, 2));
