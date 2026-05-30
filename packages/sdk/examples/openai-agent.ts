import { createOpenAIDecide, runTask } from "../src/index";

const task =
  process.argv[2] ?? "Go to https://example.com and report the H1 text via done(data=...).";

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("Set OPENAI_API_KEY env var to run this example.");
  process.exit(1);
}

const result = await runTask({
  task,
  startUrl: "about:blank",
  launch: { headless: true },
  getNextAction: createOpenAIDecide({
    model: "gpt-4.1-mini",
    apiKey,
  }),
  onStep: (step) => {
    const summary = step.action.name === "done" ? "" : ` -> ${step.result.message}`;
    console.log(
      `[${step.step}] ${step.action.name}(${JSON.stringify(step.action.params)})${summary}`,
    );
  },
});

console.log("RESULT:", JSON.stringify(result, null, 2));
