import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { ElementInfo, PageSnapshot } from "../dom/types";
import type { Page } from "./page";

export interface ScreenshotOptions {
  /** When true, overlay numeric `[index]` labels matching the snapshot before capture. */
  annotate?: boolean;
  /** Restrict overlay to a subset of element indices. Ignored when `annotate` is false. */
  annotateIndices?: number[];
  /** Snapshot providing `ElementInfo` bboxes. Required when `annotate` is true. */
  snapshot?: PageSnapshot;
}

const ANNOTATION_CONTAINER_ID = "__ba_annotations__";

export async function screenshot(page: Page, options?: ScreenshotOptions): Promise<string> {
  const shouldAnnotate = options?.annotate === true && options.snapshot !== undefined;
  if (!shouldAnnotate) {
    const result = await page.sendCDP<{ data: string }>("Page.captureScreenshot", {
      format: "png",
    });
    return result.data;
  }

  const elements = filterElementsForAnnotation(
    options!.snapshot!.elements,
    options!.annotateIndices,
  );
  try {
    await injectAnnotations(page, elements);
    const result = await page.sendCDP<{ data: string }>("Page.captureScreenshot", {
      format: "png",
    });
    return result.data;
  } finally {
    await removeAnnotations(page);
  }
}

export async function screenshotToFile(
  page: Page,
  fileName?: string,
  options?: ScreenshotOptions,
): Promise<string> {
  const base64 = await screenshot(page, options);
  const safeName = (
    fileName && fileName.trim().length > 0 ? fileName.trim() : `screenshot-${Date.now()}.png`
  ).replace(/[\\/:*?"<>|]/g, "_");
  const finalName = safeName.toLowerCase().endsWith(".png") ? safeName : `${safeName}.png`;
  const outputPath = join(process.cwd(), finalName);
  mkdirSync(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(base64, "base64"));
  return outputPath;
}

function filterElementsForAnnotation(
  elements: readonly ElementInfo[],
  indices: number[] | undefined,
): ElementInfo[] {
  if (!indices || indices.length === 0) {
    return elements.filter((el) => el.bbox.w > 0 && el.bbox.h > 0);
  }
  const set = new Set(indices);
  return elements.filter((el) => set.has(el.index) && el.bbox.w > 0 && el.bbox.h > 0);
}

async function injectAnnotations(page: Page, elements: ElementInfo[]): Promise<void> {
  // Snapshot bboxes are in document coordinates. Page.captureScreenshot
  // (default) captures the viewport, so we convert to viewport coords by
  // subtracting the current scroll offset and only emit labels for elements
  // that land inside the viewport.
  const labels = elements.map((el) => ({
    index: el.index,
    docX: el.bbox.x + el.bbox.w / 2,
    docY: el.bbox.y + el.bbox.h / 2,
  }));
  const payload = JSON.stringify(labels);
  const expression = `(() => {
    const existing = document.getElementById(${JSON.stringify(ANNOTATION_CONTAINER_ID)});
    if (existing) existing.remove();
    const container = document.createElement('div');
    container.id = ${JSON.stringify(ANNOTATION_CONTAINER_ID)};
    container.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;pointer-events:none;z-index:2147483647;';
    const sx = window.scrollX || window.pageXOffset || 0;
    const sy = window.scrollY || window.pageYOffset || 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const items = ${payload};
    let drawn = 0;
    for (const item of items) {
      const cx = item.docX - sx;
      const cy = item.docY - sy;
      if (cx < 0 || cy < 0 || cx > vw || cy > vh) continue;
      const tag = document.createElement('div');
      tag.textContent = '[' + item.index + ']';
      tag.style.cssText = 'position:fixed;transform:translate(-50%,-50%);background:#ffeb3b;color:#000;font:bold 12px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:1px 4px;border:1px solid #000;border-radius:2px;line-height:1;white-space:nowrap;pointer-events:none;';
      tag.style.left = cx + 'px';
      tag.style.top = cy + 'px';
      container.appendChild(tag);
      drawn += 1;
    }
    document.documentElement.appendChild(container);
    return drawn;
  })()`;
  await page.sendCDP("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
}

async function removeAnnotations(page: Page): Promise<void> {
  const expression = `(() => {
    const el = document.getElementById(${JSON.stringify(ANNOTATION_CONTAINER_ID)});
    if (el) el.remove();
    return true;
  })()`;
  await page.sendCDP("Runtime.evaluate", { expression, returnByValue: true }).catch(() => {});
}

export interface SaveAsPdfOptions {
  fileName?: string;
  printBackground?: boolean;
  landscape?: boolean;
  scale?: number;
  paperFormat?: "Letter" | "Legal" | "A4" | "A3" | "Tabloid";
}

const PAPER_SIZES: Record<string, { width: number; height: number }> = {
  letter: { width: 8.5, height: 11 },
  legal: { width: 8.5, height: 14 },
  a4: { width: 8.27, height: 11.69 },
  a3: { width: 11.69, height: 16.54 },
  tabloid: { width: 11, height: 17 },
};

export async function saveAsPdf(page: Page, options?: SaveAsPdfOptions): Promise<string> {
  const selected = (options?.paperFormat ?? "Letter").toLowerCase();
  const paper = PAPER_SIZES[selected] ?? PAPER_SIZES.letter!;
  const scale = options?.scale ?? 1;

  const result = await page.sendCDP<{ data: string }>("Page.printToPDF", {
    printBackground: options?.printBackground ?? true,
    landscape: options?.landscape ?? false,
    scale: Math.min(2, Math.max(0.1, scale)),
    paperWidth: paper.width,
    paperHeight: paper.height,
    preferCSSPageSize: true,
  });

  const rawFileName = options?.fileName?.trim() || `page-${Date.now()}.pdf`;
  const safeName = rawFileName.replace(/[\\/:*?"<>|]/g, "_");
  const finalName = safeName.toLowerCase().endsWith(".pdf") ? safeName : `${safeName}.pdf`;
  const outputPath = join(process.cwd(), finalName);
  mkdirSync(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(result.data, "base64"));
  return outputPath;
}
