import { describe, expect, test } from "bun:test";

import type { BrowserSession, Page } from "../../browser/session";
import type { SelectorMap } from "../../dom/cdp-snapshot";
import { handleClick, handleType } from "./interaction";
import type { HandlerContext } from "./shared";

function fakePage(targetId: string, log: string[]): Page {
  return {
    targetId,
    clickByBackendNodeId: async (backendNodeId: number) => {
      log.push(`${targetId}:click:${backendNodeId}`);
      return { ok: true };
    },
    typeByBackendNodeId: async (backendNodeId: number, text: string) => {
      log.push(`${targetId}:type:${backendNodeId}:${text}`);
      return { ok: true };
    },
  } as unknown as Page;
}

function makeCtx(log: string[]): HandlerContext {
  const mainPage = fakePage("page-1", log);
  const iframePage = fakePage("oopif-1", log);
  const session = {
    getPage: (targetId: string) => (targetId === "oopif-1" ? iframePage : mainPage),
  } as unknown as BrowserSession;
  const selectorMap: SelectorMap = {
    byIndex: new Map([
      [1, { backendNodeId: 11 }],
      [2, { backendNodeId: 22, targetId: "oopif-1" }],
    ]),
  };
  return { page: mainPage, session, selectorMap, newTabDetectMs: 0 };
}

describe("OOPIF action routing", () => {
  test("click on a main-frame element stays on the main page", async () => {
    const log: string[] = [];
    const result = await handleClick(makeCtx(log), { name: "click", params: { index: 1 } });
    expect(result.ok).toBe(true);
    expect(log).toEqual(["page-1:click:11"]);
  });

  test("click on an OOPIF element routes to the iframe target", async () => {
    const log: string[] = [];
    const result = await handleClick(makeCtx(log), { name: "click", params: { index: 2 } });
    expect(result.ok).toBe(true);
    expect(log).toEqual(["oopif-1:click:22"]);
  });

  test("type on an OOPIF element routes to the iframe target", async () => {
    const log: string[] = [];
    const result = await handleType(makeCtx(log), {
      name: "type",
      params: { index: 2, text: "Ada" },
    });
    expect(result.ok).toBe(true);
    expect(log).toEqual(["oopif-1:type:22:Ada"]);
  });

  test("missing session falls back to the main page", async () => {
    const log: string[] = [];
    const ctx = makeCtx(log);
    const noSessionCtx: HandlerContext = {
      page: ctx.page,
      selectorMap: ctx.selectorMap,
      newTabDetectMs: 0,
    };
    const result = await handleClick(noSessionCtx, { name: "click", params: { index: 2 } });
    expect(result.ok).toBe(true);
    expect(log).toEqual(["page-1:click:22"]);
  });
});
