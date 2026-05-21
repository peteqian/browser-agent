import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "./page";
import { navigationFailureStatus } from "./session-helpers";
import type { NavigationHealthResult, NavigationHealthStatus } from "./session-types";

export async function goto(
  page: Page,
  url: string,
  waitUntil: "load" | "domcontentloaded" = "load",
  timeoutMs = 30_000,
): Promise<void> {
  const navigation = await page.sendCDP<{ errorText?: string }>("Page.navigate", { url });
  if (navigation.errorText) {
    throw new Error(`Navigation failed for ${url}: ${navigation.errorText}`);
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const readyState = await page.evaluate<string>("document.readyState").catch(() => "loading");
    if (waitUntil === "domcontentloaded") {
      if (readyState === "interactive" || readyState === "complete") return;
    } else if (readyState === "complete") {
      return;
    }
    await delay(100);
  }
  throw new Error(`Navigation timeout after ${timeoutMs}ms for ${url}`);
}

export async function goBack(page: Page): Promise<boolean> {
  const history = await page.sendCDP<{ currentIndex: number; entries: Array<{ id: number }> }>(
    "Page.getNavigationHistory",
  );
  if (history.currentIndex <= 0) return false;
  const entry = history.entries[history.currentIndex - 1];
  if (!entry) return false;
  await page.sendCDP("Page.navigateToHistoryEntry", { entryId: entry.id });
  await waitForStablePage(page, 5_000).catch(() => {});
  return true;
}

export async function goForward(page: Page): Promise<boolean> {
  const history = await page.sendCDP<{ currentIndex: number; entries: Array<{ id: number }> }>(
    "Page.getNavigationHistory",
  );
  const entry = history.entries[history.currentIndex + 1];
  if (!entry) return false;
  await page.sendCDP("Page.navigateToHistoryEntry", { entryId: entry.id });
  await waitForStablePage(page, 5_000).catch(() => {});
  return true;
}

export async function refresh(page: Page): Promise<void> {
  await page.sendCDP("Page.reload", { ignoreCache: false });
  await waitForStablePage(page, 8_000).catch(() => {});
}

async function appearsEmptyPage(page: Page): Promise<boolean> {
  return page.evaluate<boolean>(`(() => {
    const body = document.body;
    if (!body) return true;
    const text = (body.innerText || "").trim();
    const hasText = text.length > 0;
    const interactive = body.querySelectorAll(
      'a,button,input,select,textarea,[role="button"],[role="link"],[tabindex]'
    ).length;
    const meaningfulMedia = body.querySelectorAll('img,video,canvas,svg,iframe,embed,object').length;
    return !hasText && interactive === 0 && meaningfulMedia === 0;
  })()`);
}

export async function navigateWithHealthCheck(
  page: Page,
  url: string,
): Promise<NavigationHealthResult> {
  const startedAt = Date.now();
  const finish = (input: { ok: boolean; status: NavigationHealthStatus; warning?: string }) =>
    finishNavigationHealth(page, { ...input, url, startedAt });

  try {
    await goto(page, url, "domcontentloaded", 8_000);
    await page.waitForStablePage(700).catch(() => {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finish({ ok: false, status: navigationFailureStatus(message), warning: message });
  }

  const isHttp = url.startsWith("http://") || url.startsWith("https://");
  if (!isHttp) return finish({ ok: true, status: "loaded" });

  let empty = await appearsEmptyPage(page).catch(() => false);
  if (!empty) return finish({ ok: true, status: "loaded" });

  await delay(700);
  empty = await appearsEmptyPage(page).catch(() => false);
  if (!empty) return finish({ ok: true, status: "loaded" });

  try {
    await goto(page, url, "domcontentloaded", 8_000);
    await page.waitForStablePage(700).catch(() => {});
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return finish({ ok: false, status: navigationFailureStatus(message), warning: message });
  }
  await delay(1_000);
  empty = await appearsEmptyPage(page).catch(() => false);
  if (empty) {
    return finish({
      ok: false,
      status: "empty",
      warning:
        "Page loaded but returned empty content. It may require anti-bot measures, failed JavaScript rendering, or have connection/proxy issues.",
    });
  }
  return finish({ ok: true, status: "loaded" });
}

async function finishNavigationHealth(
  page: Page,
  input: {
    ok: boolean;
    status: NavigationHealthStatus;
    url: string;
    startedAt: number;
    warning?: string;
  },
): Promise<NavigationHealthResult> {
  const result: NavigationHealthResult = {
    ok: input.ok,
    status: input.status,
    url: input.url,
    finalUrl: await currentUrl(page).catch(() => undefined),
    readyState: await page.evaluate<string>("document.readyState").catch(() => undefined),
    durationMs: Date.now() - input.startedAt,
    ...(input.warning ? { warning: input.warning } : {}),
  };
  await page.session.eventBus.emit({
    type: "browser_event",
    name: "navigation_watchdog",
    targetId: page.targetId,
    data: result,
  });
  return result;
}

export async function waitForText(page: Page, text: string, timeoutMs = 10_000): Promise<boolean> {
  const escaped = JSON.stringify(text);
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = await page.evaluate<boolean>(
      `document.body?.innerText?.includes(${escaped}) ?? false`,
    );
    if (found) return true;
    await delay(100);
  }
  return false;
}

export async function scrollToText(page: Page, text: string): Promise<boolean> {
  const escaped = JSON.stringify(text);
  return page.evaluate<boolean>(`(() => {
    const search = ${escaped};
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const value = (node.textContent || '').trim();
      if (!value) continue;
      if (!value.toLowerCase().includes(String(search).toLowerCase())) continue;
      const el = node.parentElement;
      if (!el) continue;
      el.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
      return true;
    }
    return false;
  })()`);
}

export async function waitForStablePage(page: Page, timeoutMs = 3_000): Promise<void> {
  const startedAt = Date.now();
  let stablePolls = 0;
  while (Date.now() - startedAt < timeoutMs) {
    const status = await page.evaluate<{ readyState: string; pendingCount: number }>(`(() => {
      const resources = performance.getEntriesByType('resource');
      let pendingCount = 0;
      for (const entry of resources) {
        if (entry.responseEnd === 0) pendingCount += 1;
      }
      return { readyState: document.readyState, pendingCount };
    })()`);
    if (status.readyState === "complete" && status.pendingCount === 0) {
      stablePolls += 1;
      if (stablePolls >= 2) return;
    } else {
      stablePolls = 0;
    }
    await delay(120);
  }
}

export async function currentUrl(page: Page): Promise<string> {
  return page.evaluate<string>("location.href");
}
