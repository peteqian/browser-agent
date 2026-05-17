import type { ElementBBox } from "../dom/types";

export interface FocusSnapshot {
  bbox: ElementBBox;
  reason: string;
  pageUrl: string;
  setAtStep: number;
}

export interface FocusState {
  get(): FocusSnapshot | null;
  set(s: FocusSnapshot): void;
  clear(): void;
  /** Clear if the recorded pageUrl no longer matches the current URL. */
  clearIfStale(currentUrl: string): void;
}

export function createFocusState(): FocusState {
  let current: FocusSnapshot | null = null;
  return {
    get: () => current,
    set: (s) => {
      current = s;
    },
    clear: () => {
      current = null;
    },
    clearIfStale: (currentUrl) => {
      if (current && current.pageUrl !== currentUrl) current = null;
    },
  };
}

export function bboxIntersects(a: ElementBBox, b: ElementBBox): boolean {
  return !(a.x + a.w < b.x || b.x + b.w < a.x || a.y + a.h < b.y || b.y + b.h < a.y);
}
