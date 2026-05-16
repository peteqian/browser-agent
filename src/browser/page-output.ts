import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { Page } from "./page";

export async function screenshot(page: Page): Promise<string> {
  const result = await page.sendCDP<{ data: string }>("Page.captureScreenshot", { format: "png" });
  return result.data;
}

export async function screenshotToFile(page: Page, fileName?: string): Promise<string> {
  const base64 = await screenshot(page);
  const safeName = (
    fileName && fileName.trim().length > 0 ? fileName.trim() : `screenshot-${Date.now()}.png`
  ).replace(/[\\/:*?"<>|]/g, "_");
  const finalName = safeName.toLowerCase().endsWith(".png") ? safeName : `${safeName}.png`;
  const outputPath = join(process.cwd(), finalName);
  mkdirSync(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, Buffer.from(base64, "base64"));
  return outputPath;
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
