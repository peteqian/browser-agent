import { describe, expect, test } from "bun:test";

import type { Page } from "../browser/session";
import { captureCdpSnapshot, withBudgetDefaults } from "./cdp-snapshot";

interface FakeCdpResponses {
  [method: string]: unknown;
}

function makePage(responses: FakeCdpResponses): Page {
  const page = {
    targetId: "page-1",
    sendCDP: async (method: string) => {
      if (method in responses) return responses[method];
      return {};
    },
    evaluate: async () => ({ readyState: "complete", pendingRequestCount: 0 }),
  };
  return page as unknown as Page;
}

/**
 * Build a DOMSnapshot.captureSnapshot fixture with the given interactive nodes.
 * Style columns (parallel to COMPUTED_STYLE_PROPS): display, visibility,
 * opacity, pointer-events, cursor, overflow, position.
 */
function buildSnapshot(
  nodes: Array<{
    tag: string;
    backendNodeId: number;
    attributes?: Array<[string, string]>;
    bounds?: [number, number, number, number];
    display?: string;
    visibility?: string;
    opacity?: string;
    paintOrder?: number;
    textInLayout?: string;
  }>,
  options: { url?: string; title?: string } = {},
) {
  const strings: string[] = [];
  const stringIdx = (value: string): number => {
    const found = strings.indexOf(value);
    if (found >= 0) return found;
    strings.push(value);
    return strings.length - 1;
  };

  const urlIdx = stringIdx(options.url ?? "https://example.com/");
  const titleIdx = stringIdx(options.title ?? "Example");

  const nodeName: number[] = [];
  const backendNodeId: number[] = [];
  const attributes: number[][] = [];
  const layoutNodeIndex: number[] = [];
  const layoutBounds: number[][] = [];
  const layoutStyles: number[][] = [];
  const layoutText: number[] = [];
  const paintOrders: number[] = [];

  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    nodeName.push(stringIdx(node.tag.toUpperCase()));
    backendNodeId.push(node.backendNodeId);
    const flatAttrs: number[] = [];
    for (const [k, v] of node.attributes ?? []) {
      flatAttrs.push(stringIdx(k), stringIdx(v));
    }
    attributes.push(flatAttrs);
    layoutNodeIndex.push(i);
    layoutBounds.push(node.bounds ?? [0, 0, 10, 10]);
    layoutStyles.push([
      stringIdx(node.display ?? "block"),
      stringIdx(node.visibility ?? "visible"),
      stringIdx(node.opacity ?? "1"),
      -1,
      -1,
      -1,
      -1,
    ]);
    layoutText.push(node.textInLayout !== undefined ? stringIdx(node.textInLayout) : -1);
    paintOrders.push(node.paintOrder ?? i);
  }

  return {
    documents: [
      {
        documentURL: urlIdx,
        title: titleIdx,
        nodes: { nodeName, backendNodeId, attributes },
        layout: {
          nodeIndex: layoutNodeIndex,
          bounds: layoutBounds,
          styles: layoutStyles,
          text: layoutText,
          paintOrders,
        },
      },
    ],
    strings,
  };
}

describe("captureCdpSnapshot", () => {
  test("filters non-interactive and hidden nodes; assigns sequential indexes", async () => {
    const snapshot = buildSnapshot([
      { tag: "div", backendNodeId: 10, bounds: [0, 0, 50, 50] }, // not interactive
      { tag: "button", backendNodeId: 11, bounds: [0, 0, 50, 50] },
      { tag: "button", backendNodeId: 12, display: "none", bounds: [0, 0, 50, 50] },
      {
        tag: "button",
        backendNodeId: 13,
        visibility: "hidden",
        bounds: [0, 0, 50, 50],
      },
      { tag: "button", backendNodeId: 14, opacity: "0", bounds: [0, 0, 50, 50] },
      { tag: "button", backendNodeId: 15, bounds: [0, 0, 0, 0] }, // zero size
      { tag: "a", backendNodeId: 16, attributes: [["href", "/x"]], bounds: [0, 0, 80, 20] },
    ]);

    const page = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": snapshot,
    });

    const { snapshot: out, selectorMap } = await captureCdpSnapshot(page, withBudgetDefaults());

    expect(out.elements).toHaveLength(2);
    expect(out.elements[0]?.index).toBe(0);
    expect(out.elements[1]?.index).toBe(1);
    expect(out.elements[0]?.tag).toBe("button");
    expect(out.elements[1]?.tag).toBe("a");
    expect(selectorMap.byIndex.get(0)?.backendNodeId).toBe(11);
    expect(selectorMap.byIndex.get(1)?.backendNodeId).toBe(16);
  });

  test("merges accessibility role and name by backendNodeId", async () => {
    const snapshot = buildSnapshot([
      {
        tag: "button",
        backendNodeId: 42,
        attributes: [["aria-label", "Submit"]],
      },
    ]);
    const page = makePage({
      "Accessibility.getFullAXTree": {
        nodes: [
          {
            backendDOMNodeId: 42,
            role: { value: "button" },
            name: { value: "Submit form" },
          },
        ],
      },
      "DOMSnapshot.captureSnapshot": snapshot,
    });

    const { snapshot: out } = await captureCdpSnapshot(page, withBudgetDefaults());
    expect(out.elements[0]?.role).toBe("button");
    expect(out.elements[0]?.ariaName).toBe("Submit form");
  });

  test("sorts elements by paint order", async () => {
    const snapshot = buildSnapshot([
      { tag: "button", backendNodeId: 1, paintOrder: 5 },
      { tag: "button", backendNodeId: 2, paintOrder: 1 },
      { tag: "button", backendNodeId: 3, paintOrder: 3 },
    ]);
    const page = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": snapshot,
    });

    const { selectorMap } = await captureCdpSnapshot(page, withBudgetDefaults());
    expect(selectorMap.byIndex.get(0)?.backendNodeId).toBe(2);
    expect(selectorMap.byIndex.get(1)?.backendNodeId).toBe(3);
    expect(selectorMap.byIndex.get(2)?.backendNodeId).toBe(1);
  });

  test("respects maxElements budget", async () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({
      tag: "button",
      backendNodeId: 100 + i,
      paintOrder: i,
    }));
    const snapshot = buildSnapshot(nodes);
    const page = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": snapshot,
    });

    const { snapshot: out, selectorMap } = await captureCdpSnapshot(
      page,
      withBudgetDefaults({ maxElements: 3 }),
    );
    expect(out.elements).toHaveLength(3);
    expect([...selectorMap.byIndex.keys()]).toEqual([0, 1, 2]);
  });

  test("includes role from attribute fallback when AX tree is missing", async () => {
    const snapshot = buildSnapshot([
      { tag: "div", backendNodeId: 9, attributes: [["role", "button"]] },
    ]);
    const page = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": snapshot,
    });
    const { snapshot: out } = await captureCdpSnapshot(page, withBudgetDefaults());
    expect(out.elements).toHaveLength(1);
    expect(out.elements[0]?.role).toBe("button");
  });
});
