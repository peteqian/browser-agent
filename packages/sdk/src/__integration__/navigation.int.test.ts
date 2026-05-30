import { describe, expect, test } from "bun:test";

import { integrationEnabled, withIntegrationContext } from "./helper";

describe.skipIf(!integrationEnabled)("integration: navigation against fixture pages", () => {
  test("navigates to /form and reads the page title", async () => {
    await withIntegrationContext(async ({ baseUrl, page }) => {
      await page.navigateWithHealthCheck(`${baseUrl}/form`);
      const title = await page.evaluate<string>("document.title");
      expect(title).toBe("Form");
    });
  });
});
