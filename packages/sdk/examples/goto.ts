import { BrowserSession } from "../src/index";

async function main() {
  const session = await BrowserSession.launch({ headless: true });

  try {
    const page = await session.newPage();
    await page.goto("https://example.com");
    const title = await page.title();
    const heading = await page.evaluate<string>(
      "document.querySelector('h1')?.textContent ?? '(no h1)'",
    );
    console.log({ title, heading });
  } finally {
    await session.close();
  }
}

await main();
