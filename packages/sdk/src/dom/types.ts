import type { SelectorMap } from "./cdp-snapshot";

export interface ElementBBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type StableHandleKind = "testid" | "role" | "label" | "href" | "text" | "index";

export interface StableHandle {
  kind: StableHandleKind;
  /** Human-readable representation, e.g. `testid="ss"` or `role=button name="Search"`. */
  value: string;
}

export interface ElementInfo {
  index: number;
  backendNodeId: number;
  framePath: string;
  tag: string;
  role: string | null;
  text: string;
  href: string | null;
  name: string | null;
  ariaName: string | null;
  type: string | null;
  placeholder: string | null;
  value: string | null;
  ariaLabel: string | null;
  selectorHint: string;
  bbox: ElementBBox;
  /** Role computed by the accessibility tree (distinct from `role`, which may be a DOM attribute). */
  axRole: string | null;
  /** Accessible name from the AX tree (distinct from `ariaName`, which is the same source but kept for back-compat). */
  axName: string | null;
  /** `data-testid` (or `data-test`/`data-cy`/`data-qa`/`data-action`) if present. */
  testId: string | null;
  /** Other captured `data-*` attributes, keyed without the `data-` prefix. */
  dataAttrs: Record<string, string>;
  /** Resolved associated label text (via `<label for>`, wrapping `<label>`, or `aria-labelledby`). */
  labelText: string | null;
  /** Most-durable identifier we can advertise to the agent. */
  stableHandle: StableHandle;
  /**
   * Stable cross-snapshot identifier. Hash of frame + tag + axRole + axName
   * + testId + a bucketed y-coordinate. Same conceptual element should
   * resolve to the same `stableId` across re-renders. Falls back to the
   * volatile numeric index when no stable identity is computable.
   */
  stableId: string;
}

export interface PageStabilityInfo {
  readyState: string;
  pendingRequestCount: number;
}

export interface PageSnapshot {
  url: string;
  title: string;
  elements: ElementInfo[];
  stability: PageStabilityInfo;
}

export type { SelectorMap };
