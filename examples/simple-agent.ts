import { Agent, Browser } from "../src/index";

const task = process.argv[2] ?? "Go to https://example.com and report the H1 text.";

const browser = new Browser();
const agent = new Agent({
  task,
  browser,
  startUrl: "about:blank",
  maxSteps: 15,
});

try {
  const result = await agent.run();
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
