import { describe, expect, test } from "bun:test";

import {
  clickHoldDelayMs,
  createRng,
  mousePathPoints,
  mouseStepDelayMs,
  resolveHumanize,
  typingDelaysMs,
} from "./humanize";
import { clickAtCoordinates, humanClickAtCoordinates, keyboardType } from "../page/page-input";
import type { Page } from "../page/page";

describe("resolveHumanize", () => {
  test("off by default", () => {
    expect(resolveHumanize()).toBeNull();
    expect(resolveHumanize(false)).toBeNull();
  });

  test("true enables mouse + typing at speed 1", () => {
    const resolved = resolveHumanize(true);
    expect(resolved).toMatchObject({ mouse: true, typing: true, speed: 1 });
  });

  test("config can disable parts", () => {
    const resolved = resolveHumanize({ mouse: false, speed: 0.5 });
    expect(resolved).toMatchObject({ mouse: false, typing: true, speed: 0.5 });
  });
});

describe("createRng", () => {
  test("seeded rng is deterministic and in [0, 1)", () => {
    const a = createRng(42);
    const b = createRng(42);
    for (let i = 0; i < 100; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("mousePathPoints", () => {
  test("ends exactly at the target", () => {
    const rng = createRng(1);
    const points = mousePathPoints({ x: 0, y: 0 }, { x: 500, y: 300 }, rng);
    const last = points[points.length - 1]!;
    expect(last).toEqual({ x: 500, y: 300 });
  });

  test("step count scales with distance within bounds", () => {
    const rng = createRng(1);
    const short = mousePathPoints({ x: 0, y: 0 }, { x: 40, y: 0 }, rng);
    const long = mousePathPoints({ x: 0, y: 0 }, { x: 2000, y: 0 }, createRng(1));
    expect(short.length).toBeGreaterThanOrEqual(6);
    expect(long.length).toBeLessThanOrEqual(28);
    expect(long.length).toBeGreaterThan(short.length);
  });

  test("tiny moves jump straight to the target", () => {
    const points = mousePathPoints({ x: 10, y: 10 }, { x: 11, y: 10 }, createRng(1));
    expect(points).toEqual([{ x: 11, y: 10 }]);
  });

  test("path is curved, not a straight teleport", () => {
    const points = mousePathPoints({ x: 0, y: 0 }, { x: 600, y: 0 }, createRng(7));
    const offAxis = points.some((p) => Math.abs(p.y) > 2);
    expect(offAxis).toBe(true);
  });
});

describe("delays", () => {
  test("speed 0 produces zero delays", () => {
    const rng = createRng(3);
    expect(mouseStepDelayMs(1, 10, 0, rng)).toBe(0);
    expect(clickHoldDelayMs(0, rng)).toBe(0);
    expect(typingDelaysMs("hello world", 0, rng).every((d) => d === 0)).toBe(true);
  });

  test("typing delays vary and stay human-plausible", () => {
    const delays = typingDelaysMs("the quick brown fox jumps over it", 1, createRng(9));
    expect(new Set(delays).size).toBeGreaterThan(5);
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(30);
      expect(d).toBeLessThan(700);
    }
  });

  test("click hold is in the 50-140ms human band", () => {
    const rng = createRng(11);
    for (let i = 0; i < 20; i++) {
      const hold = clickHoldDelayMs(1, rng);
      expect(hold).toBeGreaterThanOrEqual(50);
      expect(hold).toBeLessThanOrEqual(140);
    }
  });
});

interface DispatchedEvent {
  method: string;
  params: Record<string, unknown>;
}

function fakePage(humanize: unknown): { page: Page; events: DispatchedEvent[] } {
  const events: DispatchedEvent[] = [];
  const page = {
    session: { profile: { humanize } },
    sendCDP: async (method: string, params: Record<string, unknown>) => {
      events.push({ method, params });
      return {};
    },
  } as unknown as Page;
  return { page, events };
}

describe("humanized dispatch through page-input", () => {
  test("plain click without humanize dispatches 3 events", async () => {
    const { page, events } = fakePage(undefined);
    await clickAtCoordinates(page, 100, 100);
    expect(events.map((e) => (e.params as { type: string }).type)).toEqual([
      "mouseMoved",
      "mousePressed",
      "mouseReleased",
    ]);
  });

  test("humanized click traces a multi-point path before pressing", async () => {
    const { page, events } = fakePage({ seed: 5, speed: 0 });
    await clickAtCoordinates(page, 400, 300);
    const types = events.map((e) => (e.params as { type: string }).type);
    expect(types.filter((t) => t === "mouseMoved").length).toBeGreaterThanOrEqual(6);
    expect(types[types.length - 2]).toBe("mousePressed");
    expect(types[types.length - 1]).toBe("mouseReleased");
    const press = events[events.length - 2]!.params as { x: number; y: number };
    expect(press.x).toBe(400);
    expect(press.y).toBe(300);
  });

  test("humanClickAtCoordinates humanizes even when profile is off", async () => {
    const { page, events } = fakePage(undefined);
    await humanClickAtCoordinates(page, 200, 200, {
      mouse: true,
      typing: true,
      speed: 0,
      rng: createRng(2),
    });
    const types = events.map((e) => (e.params as { type: string }).type);
    expect(types.filter((t) => t === "mouseMoved").length).toBeGreaterThanOrEqual(6);
  });

  test("typing dispatches one char event per character", async () => {
    const { page, events } = fakePage({ seed: 5, speed: 0 });
    await keyboardType(page, "abc");
    expect(events.length).toBe(3);
    expect(events.every((e) => e.method === "Input.dispatchKeyEvent")).toBe(true);
  });
});
