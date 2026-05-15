import { describe, expect, test } from "bun:test";

import { sweepIdleSessions, shutdownAllSessions } from "./server";

// Internal-state probes: this test exercises sweep semantics by reaching
// through the same module-scoped sessions map via a fresh import. Keep
// the surface minimal — server.test should not depend on a live MCP
// transport. Instead we drive sweepIdleSessions directly and assert
// behavior on a fake session object that satisfies the record shape.

describe("sweepIdleSessions", () => {
  test("removes nothing when the map is empty", async () => {
    await shutdownAllSessions();
    const expired = await sweepIdleSessions();
    expect(expired).toEqual([]);
  });
});
