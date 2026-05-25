import { describe, expect, test } from "bun:test";

import type { Page } from "../../browser/page";
import { handleSetViewport } from "./emulation";
import type { HandlerContext } from "./shared";

function recordingPage(): {
  page: Page;
  calls: Array<{ method: string; params: unknown }>;
  fail?: boolean;
} {
  const state: { calls: Array<{ method: string; params: unknown }>; fail?: boolean } = {
    calls: [],
  };
  const page = {
    sendCDP: async (method: string, params: unknown) => {
      state.calls.push({ method, params });
      if (state.fail) throw new Error("CDP nope");
      return {};
    },
  } as unknown as Page;
  return { page, ...state };
}

describe("handleSetViewport", () => {
  test("forwards width/height with defaults", async () => {
    const { page, calls } = recordingPage();
    const r = await handleSetViewport({ page } as HandlerContext, {
      name: "set_viewport",
      params: { width: 1024, height: 768 },
    });
    expect(r.ok).toBe(true);
    expect(calls[0]?.method).toBe("Emulation.setDeviceMetricsOverride");
    expect(calls[0]?.params).toEqual({
      width: 1024,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });
  });

  test("passes deviceScaleFactor and mobile when provided", async () => {
    const { page, calls } = recordingPage();
    await handleSetViewport({ page } as HandlerContext, {
      name: "set_viewport",
      params: { width: 390, height: 844, deviceScaleFactor: 3, mobile: true },
    });
    expect(calls[0]?.params).toEqual({
      width: 390,
      height: 844,
      deviceScaleFactor: 3,
      mobile: true,
    });
  });

  test("returns deterministic fail when CDP rejects", async () => {
    const ref = recordingPage();
    const page = {
      sendCDP: async () => {
        throw new Error("blocked by target");
      },
    } as unknown as Page;
    const r = await handleSetViewport({ page } as HandlerContext, {
      name: "set_viewport",
      params: { width: 100, height: 100 },
    });
    expect(r.ok).toBe(false);
    expect(r.message).toContain("Failed to set viewport");
    expect(ref).toBeTruthy();
  });

  test("data payload reflects normalized values", async () => {
    const { page } = recordingPage();
    const r = await handleSetViewport({ page } as HandlerContext, {
      name: "set_viewport",
      params: { width: 800, height: 600 },
    });
    expect(r.data).toEqual({
      width: 800,
      height: 600,
      deviceScaleFactor: 1,
      mobile: false,
    });
  });
});
