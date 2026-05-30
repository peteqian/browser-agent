import { describe, expect, test } from "bun:test";

import { createDefaultLogger, noopLogger } from "./logger";

describe("createDefaultLogger", () => {
  test("emits JSONL with level, event, timestamp", () => {
    const lines: string[] = [];
    const logger = createDefaultLogger({ write: (l) => lines.push(l) });
    logger.info("foo", { bar: 1 });
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("foo");
    expect(parsed.bar).toBe(1);
    expect(typeof parsed.ts).toBe("string");
  });

  test("respects minLevel", () => {
    const lines: string[] = [];
    const logger = createDefaultLogger({ minLevel: "warn", write: (l) => lines.push(l) });
    logger.debug("a");
    logger.info("b");
    logger.warn("c");
    logger.error("d");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).event).toBe("c");
    expect(JSON.parse(lines[1]!).event).toBe("d");
  });

  test("emits without data payload", () => {
    const lines: string[] = [];
    const logger = createDefaultLogger({ write: (l) => lines.push(l) });
    logger.error("boom");
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.event).toBe("boom");
    expect(parsed.level).toBe("error");
  });
});

describe("noopLogger", () => {
  test("drops every call without throwing", () => {
    expect(() => {
      noopLogger.debug("a");
      noopLogger.info("b");
      noopLogger.warn("c");
      noopLogger.error("d", { x: 1 });
    }).not.toThrow();
  });
});
