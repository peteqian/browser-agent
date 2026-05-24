import { Browser, runTask } from "../src/index";

const task = process.argv[2] ?? "Go to https://example.com and report the H1 text.";

const browser = new Browser();

try {
  const result = await runTask({
    task,
    browser,
    startUrl: "about:blank",
  });
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
