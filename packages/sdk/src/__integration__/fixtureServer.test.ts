import { describe, expect, test } from "bun:test";

import { DEFAULT_FIXTURES, fixtureResponse } from "./fixtureServer";

describe("fixture server", () => {
  test("serves the default upload fixture with a hidden file input", async () => {
    const res = fixtureResponse(DEFAULT_FIXTURES, "/upload");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('type="file"');
    expect(body).toContain('id="trigger"');
  });

  test("returns 404 for unknown paths", async () => {
    const res = fixtureResponse(DEFAULT_FIXTURES, "/missing");
    expect(res.status).toBe(404);
  });

  test("includes the auth new-tab fixture", () => {
    expect(DEFAULT_FIXTURES["/auth-newtab"]).toContain('target="_blank"');
  });
});
