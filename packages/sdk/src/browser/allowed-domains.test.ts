import { describe, expect, test } from "bun:test";

import { matchesAllowedDomains } from "./allowed-domains";

describe("matchesAllowedDomains", () => {
  test("undefined or empty patterns allow everything", () => {
    expect(matchesAllowedDomains("https://evil.com/x", undefined)).toBe(true);
    expect(matchesAllowedDomains("https://evil.com/x", [])).toBe(true);
  });

  test("exact host match", () => {
    expect(matchesAllowedDomains("https://example.com/path", ["example.com"])).toBe(true);
    expect(matchesAllowedDomains("https://sub.example.com/", ["example.com"])).toBe(false);
    expect(matchesAllowedDomains("https://otherexample.com/", ["example.com"])).toBe(false);
  });

  test("wildcard matches subdomains and bare apex", () => {
    expect(matchesAllowedDomains("https://example.com/", ["*.example.com"])).toBe(true);
    expect(matchesAllowedDomains("https://a.example.com/", ["*.example.com"])).toBe(true);
    expect(matchesAllowedDomains("https://a.b.example.com/", ["*.example.com"])).toBe(true);
    expect(matchesAllowedDomains("https://notexample.com/", ["*.example.com"])).toBe(false);
  });

  test("case-insensitive", () => {
    expect(matchesAllowedDomains("https://EXAMPLE.com/", ["Example.com"])).toBe(true);
  });

  test("non-http(s) protocols bypass the check", () => {
    expect(matchesAllowedDomains("about:blank", ["example.com"])).toBe(true);
    expect(matchesAllowedDomains("file:///tmp/foo.html", ["example.com"])).toBe(true);
  });

  test("malformed URLs are rejected", () => {
    expect(matchesAllowedDomains("not a url", ["example.com"])).toBe(false);
  });

  test("multiple patterns are OR-combined", () => {
    const patterns = ["example.com", "*.allowed.io"];
    expect(matchesAllowedDomains("https://example.com/", patterns)).toBe(true);
    expect(matchesAllowedDomains("https://x.allowed.io/", patterns)).toBe(true);
    expect(matchesAllowedDomains("https://denied.com/", patterns)).toBe(false);
  });
});
