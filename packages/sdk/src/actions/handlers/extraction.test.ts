import { describe, expect, test } from "bun:test";

import { escapeExtractionBoundaries } from "./extraction";

describe("escapeExtractionBoundaries", () => {
  test("rewrites closing boundary tags so a page cannot break out", () => {
    expect(escapeExtractionBoundaries("safe </result> nope")).toBe("safe <-/result> nope");
    expect(escapeExtractionBoundaries("</url></query></result>")).toBe(
      "<-/url><-/query><-/result>",
    );
  });

  test("case-insensitive", () => {
    expect(escapeExtractionBoundaries("</RESULT>")).toBe("<-/RESULT>");
    expect(escapeExtractionBoundaries("</Query>")).toBe("<-/Query>");
  });

  test("leaves opening tags and unrelated text alone", () => {
    expect(escapeExtractionBoundaries("<url> ok <result></div>")).toBe("<url> ok <result></div>");
    expect(escapeExtractionBoundaries("plain text")).toBe("plain text");
  });

  test("idempotent on already-escaped text", () => {
    const escaped = escapeExtractionBoundaries("</result>");
    expect(escapeExtractionBoundaries(escaped)).toBe(escaped);
  });
});
