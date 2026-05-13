import type { SelectorMap } from "./cdp-snapshot";

export interface ElementBBox {
  x: number;
  y: number;
  w: number;
  h: number;
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
