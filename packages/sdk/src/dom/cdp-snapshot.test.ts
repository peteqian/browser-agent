import { describe, expect, test } from "bun:test";

import type { Page } from "../browser/session/session";
import { captureCdpSnapshot, withBudgetDefaults } from "./cdp-snapshot";

interface FakeCdpResponses {
  [method: string]: unknown;
}

function makePage(
  responses: FakeCdpResponses,
  options: {
    callOnBackendNode?: Page["callOnBackendNode"];
  } = {},
): Page {
  const page = {
    targetId: "page-1",
    sendCDP: async (method: string) => {
      if (method in responses) return responses[method];
      return {};
    },
    evaluate: async () => ({ readyState: "complete", pendingRequestCount: 0 }),
    ...options,
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
      {
        tag: "button",
        backendNodeId: 11,
        attributes: [["aria-label", "Visible"]],
        bounds: [0, 0, 50, 50],
      },
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
      { tag: "button", backendNodeId: 1, attributes: [["aria-label", "One"]], paintOrder: 5 },
      { tag: "button", backendNodeId: 2, attributes: [["aria-label", "Two"]], paintOrder: 1 },
      { tag: "button", backendNodeId: 3, attributes: [["aria-label", "Three"]], paintOrder: 3 },
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
      attributes: [["aria-label", `Button ${i}`]] as Array<[string, string]>,
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
      {
        tag: "div",
        backendNodeId: 9,
        attributes: [
          ["role", "button"],
          ["aria-label", "Role button"],
        ],
      },
    ]);
    const page = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": snapshot,
    });
    const { snapshot: out } = await captureCdpSnapshot(page, withBudgetDefaults());
    expect(out.elements).toHaveLength(1);
    expect(out.elements[0]?.role).toBe("button");
  });

  test("keeps AX-only comboboxes from app-rendered search forms", async () => {
    const snapshot = buildSnapshot([
      {
        tag: "div",
        backendNodeId: 21,
        bounds: [10, 80, 280, 48],
      },
      {
        tag: "div",
        backendNodeId: 22,
        bounds: [300, 80, 280, 48],
      },
      {
        tag: "button",
        backendNodeId: 23,
        bounds: [590, 80, 120, 48],
      },
    ]);
    const page = makePage({
      "Accessibility.getFullAXTree": {
        nodes: [
          {
            backendDOMNodeId: 21,
            role: { value: "combobox" },
            name: { value: "Work " },
          },
          {
            backendDOMNodeId: 22,
            role: { value: "combobox" },
            name: { value: "Enter suburb, city, or region" },
          },
          {
            backendDOMNodeId: 23,
            role: { value: "button" },
            name: { value: "Submit search" },
          },
        ],
      },
      "DOMSnapshot.captureSnapshot": snapshot,
    });

    const { snapshot: out } = await captureCdpSnapshot(page, withBudgetDefaults());

    expect(out.elements.map((el) => [el.axRole, el.axName])).toEqual([
      ["combobox", "Work"],
      ["combobox", "Enter suburb, city, or region"],
      ["button", "Submit search"],
    ]);
  });

  test("keeps named AX content regions that orient form controls", async () => {
    const snapshot = buildSnapshot([
      {
        tag: "section",
        backendNodeId: 31,
        bounds: [0, 60, 300, 70],
      },
      {
        tag: "div",
        backendNodeId: 32,
        bounds: [10, 80, 280, 48],
      },
    ]);
    const page = makePage({
      "Accessibility.getFullAXTree": {
        nodes: [
          {
            backendDOMNodeId: 31,
            role: { value: "region" },
            name: { value: "Enter keywords" },
          },
          {
            backendDOMNodeId: 32,
            role: { value: "combobox" },
            name: { value: "Work " },
          },
        ],
      },
      "DOMSnapshot.captureSnapshot": snapshot,
    });

    const { snapshot: out } = await captureCdpSnapshot(page, withBudgetDefaults());

    expect(out.elements.map((el) => `${el.axRole}:${el.axName}`)).toEqual([
      "region:Enter keywords",
      "combobox:Work",
    ]);
  });

  test("seeds observable controls from AX when DOMSnapshot has no layout node", async () => {
    const snapshot = buildSnapshot([]);
    const page = makePage(
      {
        "Accessibility.getFullAXTree": {
          nodes: [
            {
              backendDOMNodeId: 38,
              role: { value: "combobox" },
              name: { value: "Registered nurse with flexible part-time hours" },
            },
            {
              backendDOMNodeId: 29,
              role: { value: "combobox" },
              name: { value: "Enter suburb, city, or region" },
            },
            {
              backendDOMNodeId: 2113,
              role: { value: "button" },
              name: { value: "Submit search" },
            },
          ],
        },
        "DOMSnapshot.captureSnapshot": snapshot,
      },
      {
        callOnBackendNode: async (backendNodeId: number) => {
          const byId = {
            38: {
              tag: "div",
              text: "",
              attrs: {},
              bounds: { x: 10, y: 80, w: 280, h: 48 },
            },
            29: {
              tag: "div",
              text: "",
              attrs: {},
              bounds: { x: 300, y: 80, w: 280, h: 48 },
            },
            2113: {
              tag: "button",
              text: "Search",
              attrs: {},
              bounds: { x: 590, y: 80, w: 120, h: 48 },
            },
          } as const;
          return { ok: true, value: byId[backendNodeId as keyof typeof byId] ?? null };
        },
      },
    );

    const { snapshot: out, selectorMap } = await captureCdpSnapshot(page, withBudgetDefaults());

    expect(out.elements.map((el) => [el.axRole, el.axName])).toEqual([
      ["combobox", "Registered nurse with flexible part-time hours"],
      ["combobox", "Enter suburb, city, or region"],
      ["button", "Submit search"],
    ]);
    expect(selectorMap.byIndex.get(0)?.backendNodeId).toBe(38);
    expect(selectorMap.byIndex.get(2)?.backendNodeId).toBe(2113);
  });

  test("captures testId and dataAttrs", async () => {
    const snapshot = buildSnapshot([
      {
        tag: "input",
        backendNodeId: 1,
        attributes: [
          ["data-testid", "ss-input"],
          ["data-analytics", "search-bar"],
          ["placeholder", "Where are you going?"],
        ],
      },
    ]);
    const page = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": snapshot,
    });
    const { snapshot: out } = await captureCdpSnapshot(page, withBudgetDefaults());
    const el = out.elements[0];
    expect(el?.testId).toBe("ss-input");
    expect(el?.dataAttrs.analytics).toBe("search-bar");
    expect(el?.stableHandle.kind).toBe("testid");
    expect(el?.stableHandle.value).toBe('testid="ss-input"');
  });

  test("resolves labelText via <label for=id>", async () => {
    const snapshot = buildSnapshot([
      {
        tag: "label",
        backendNodeId: 100,
        attributes: [["for", "email"]],
        textInLayout: "Email address",
      },
      {
        tag: "input",
        backendNodeId: 101,
        attributes: [
          ["id", "email"],
          ["type", "email"],
        ],
        paintOrder: 1,
      },
    ]);
    const page = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": snapshot,
    });
    const { snapshot: out } = await captureCdpSnapshot(page, withBudgetDefaults());
    const input = out.elements.find((el) => el.tag === "input");
    expect(input?.labelText).toBe("Email address");
    expect(input?.stableHandle.kind).toBe("label");
    expect(input?.stableHandle.value).toBe('label="Email address"');
  });

  test("stableHandle prefers role+name over href and text", async () => {
    const snapshot = buildSnapshot([
      {
        tag: "button",
        backendNodeId: 7,
        attributes: [["aria-label", "Search"]],
        textInLayout: "Search",
      },
    ]);
    const page = makePage({
      "Accessibility.getFullAXTree": {
        nodes: [{ backendDOMNodeId: 7, role: { value: "button" }, name: { value: "Search" } }],
      },
      "DOMSnapshot.captureSnapshot": snapshot,
    });
    const { snapshot: out } = await captureCdpSnapshot(page, withBudgetDefaults());
    expect(out.elements[0]?.stableHandle).toEqual({
      kind: "role",
      value: 'role=button name="Search"',
    });
  });

  test("falls back to href handle for anchors with no role/name", async () => {
    const snapshot = buildSnapshot([
      { tag: "a", backendNodeId: 3, attributes: [["href", "/listings/123"]] },
    ]);
    const page = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": snapshot,
    });
    const { snapshot: out } = await captureCdpSnapshot(page, withBudgetDefaults());
    expect(out.elements[0]?.stableHandle.kind).toBe("href");
    expect(out.elements[0]?.stableHandle.value).toBe('href="/listings/123"');
  });
});

describe("cross-origin iframes", () => {
  test("iframe without captured content document is flagged and keeps its src", async () => {
    const snapshot = buildSnapshot([
      {
        tag: "iframe",
        backendNodeId: 30,
        attributes: [
          ["src", "https://boards.greenhouse.io/embed/job_app?token=123"],
          ["title", "Application form"],
        ],
        bounds: [0, 100, 800, 900],
      },
      { tag: "button", backendNodeId: 31, attributes: [["aria-label", "Apply"]] },
    ]);

    const page = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": snapshot,
    });

    const { snapshot: out } = await captureCdpSnapshot(page, withBudgetDefaults());

    const iframe = out.elements.find((el) => el.tag === "iframe");
    expect(iframe).toBeDefined();
    expect(iframe?.crossOriginIframe).toBe(true);
    expect(iframe?.href).toBe("https://boards.greenhouse.io/embed/job_app?token=123");
  });

  test("iframe with a captured content document is not flagged", async () => {
    const snapshot = buildSnapshot([
      { tag: "iframe", backendNodeId: 40, attributes: [["src", "/same-origin"]] },
      { tag: "button", backendNodeId: 41, attributes: [["aria-label", "Go"]] },
    ]) as {
      documents: Array<{ nodes: Record<string, unknown> }>;
      strings: string[];
    };
    // Same-process iframes carry a contentDocumentIndex entry for the node.
    snapshot.documents[0]!.nodes.contentDocumentIndex = { index: [0], value: [0] };

    const page = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": snapshot,
    });

    const { snapshot: out } = await captureCdpSnapshot(page, withBudgetDefaults());
    const iframe = out.elements.find((el) => el.tag === "iframe");
    expect(iframe?.crossOriginIframe).toBeUndefined();
  });
});

describe("OOPIF expansion", () => {
  test("merges cross-origin iframe content with translated coordinates and targetId routing", async () => {
    const mainSnapshot = buildSnapshot([
      {
        tag: "iframe",
        backendNodeId: 50,
        attributes: [["src", "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1"]],
        bounds: [100, 200, 800, 900],
      },
      { tag: "button", backendNodeId: 51, attributes: [["aria-label", "Home"]] },
    ]);
    const childSnapshot = buildSnapshot(
      [
        {
          tag: "input",
          backendNodeId: 7,
          attributes: [
            ["aria-label", "First Name"],
            ["type", "text"],
          ],
          bounds: [10, 20, 300, 40],
        },
      ],
      { url: "https://job-boards.greenhouse.io/embed/job_app", title: "Application" },
    );

    const childPage = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": childSnapshot,
    });
    const mainPage = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": mainSnapshot,
    }) as unknown as Record<string, unknown>;
    mainPage.session = {
      send: async (method: string) => {
        if (method === "Target.getTargets") {
          return {
            targetInfos: [
              { targetId: "page-1", type: "page", url: "https://acme.com/jobs" },
              {
                targetId: "oopif-1",
                type: "iframe",
                url: "https://job-boards.greenhouse.io/embed/job_app?for=acme&token=1",
              },
            ],
          };
        }
        return {};
      },
      getPage: (targetId: string) => {
        expect(targetId).toBe("oopif-1");
        return childPage;
      },
    };

    const { snapshot: out, selectorMap } = await captureCdpSnapshot(
      mainPage as unknown as Page,
      withBudgetDefaults(),
    );

    const merged = out.elements.find((el) => el.framePath === "oopif:oopif-1");
    expect(merged).toBeDefined();
    expect(merged?.tag).toBe("input");
    // bbox translated by the iframe's origin (100, 200)
    expect(merged?.bbox).toEqual({ x: 110, y: 220, w: 300, h: 40 });

    const entry = selectorMap.byIndex.get(merged!.index);
    expect(entry).toMatchObject({ backendNodeId: 7, targetId: "oopif-1" });

    // The iframe element itself no longer claims its content is hidden.
    const iframe = out.elements.find((el) => el.tag === "iframe");
    expect(iframe?.crossOriginIframe).toBeUndefined();
  });

  test("keeps the hidden-content flag when no iframe target matches", async () => {
    const mainSnapshot = buildSnapshot([
      {
        tag: "iframe",
        backendNodeId: 60,
        attributes: [["src", "https://unmatched.example.com/embed"]],
        bounds: [0, 0, 500, 500],
      },
      { tag: "button", backendNodeId: 61, attributes: [["aria-label", "Go"]] },
      {
        tag: "iframe",
        backendNodeId: 62,
        attributes: [["src", "https://other.example.com/x"]],
        bounds: [0, 600, 500, 100],
      },
    ]);
    const mainPage = makePage({
      "Accessibility.getFullAXTree": { nodes: [] },
      "DOMSnapshot.captureSnapshot": mainSnapshot,
    }) as unknown as Record<string, unknown>;
    mainPage.session = {
      send: async () => ({ targetInfos: [] }),
      getPage: () => {
        throw new Error("should not attach");
      },
    };

    const { snapshot: out } = await captureCdpSnapshot(
      mainPage as unknown as Page,
      withBudgetDefaults(),
    );
    const iframes = out.elements.filter((el) => el.tag === "iframe");
    expect(iframes.every((el) => el.crossOriginIframe === true)).toBe(true);
  });
});
