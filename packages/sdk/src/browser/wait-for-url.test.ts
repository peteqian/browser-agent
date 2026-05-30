import { describe, expect, test } from "bun:test";

import type { Page } from "./page";
import { urlMatchesPattern, waitForUrl } from "./page-navigation";

describe("urlMatchesPattern", () => {
  test("bare substring is a contains-check", () => {
    expect(urlMatchesPattern("https://example.com/dashboard", "/dashboard")).toBe(true);
    expect(urlMatchesPattern("https://example.com/login", "/dashboard")).toBe(false);
  });

  test("wildcard matches any characters", () => {
    expect(urlMatchesPattern("https://example.com/abc/end", "https://example.com/*/end")).toBe(
      true,
    );
    expect(urlMatchesPattern("https://api.example.com/", "https://*.example.com/*")).toBe(true);
    expect(urlMatchesPattern("https://evil.com/example.com", "https://*.example.com/*")).toBe(
      false,
    );
  });

  test("regex metacharacters in the pattern are escaped when wildcard is present", () => {
    // Contains-check path: `?` and `.` are literal substrings, not regex.
    expect(urlMatchesPattern("https://example.com/?q=1", "?q=1")).toBe(true);
    // Wildcard path: `.` in the pattern must not match arbitrary chars.
    expect(urlMatchesPattern("https://exampleAcom/x", "https://example.com/*")).toBe(false);
  });

  test("anchored wildcard pattern rejects extra suffix", () => {
    expect(urlMatchesPattern("https://example.com/x/extra", "https://example.com/*")).toBe(true);
    expect(urlMatchesPattern("https://example.com/x", "https://example.com/y*")).toBe(false);
  });
});

describe("waitForUrl", () => {
  function pageWith(urls: readonly string[]): Page {
    let i = 0;
    return {
      currentUrl: async () => {
        const v = urls[Math.min(i, urls.length - 1)];
        i += 1;
        return v;
      },
    } as unknown as Page;
  }

  test("returns the matching URL on first hit", async () => {
    const page = pageWith(["https://example.com/dashboard"]);
    const url = await waitForUrl(page, "/dashboard", 200, 10);
    expect(url).toBe("https://example.com/dashboard");
  });

  test("polls until the URL matches", async () => {
    const page = pageWith([
      "https://example.com/loading",
      "https://example.com/loading",
      "https://example.com/done",
    ]);
    const url = await waitForUrl(page, "/done", 500, 5);
    expect(url).toBe("https://example.com/done");
  });

  test("returns null on timeout without a match", async () => {
    const page = pageWith(["https://example.com/x"]);
    const url = await waitForUrl(page, "/never", 30, 10);
    expect(url).toBeNull();
  });

  test("currentUrl throws are swallowed", async () => {
    let i = 0;
    const page = {
      currentUrl: async () => {
        i += 1;
        if (i < 2) throw new Error("not yet");
        return "https://example.com/ready";
      },
    } as unknown as Page;
    const url = await waitForUrl(page, "/ready", 200, 10);
    expect(url).toBe("https://example.com/ready");
  });
});
