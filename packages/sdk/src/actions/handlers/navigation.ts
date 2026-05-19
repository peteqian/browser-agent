import type { Action } from "../types";
import { fail, ok, requireSession, type ActionResult, type HandlerContext } from "./shared";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

export async function handleNavigate(
  ctx: HandlerContext,
  action: ByName<"navigate">,
): Promise<ActionResult> {
  const newTab = action.params.newTab ?? false;
  const targetPage = newTab ? await requireSession(ctx.session, action.name).newPage() : ctx.page;

  const health = await targetPage.navigateWithHealthCheck(action.params.url);
  if (!health.ok) {
    const warning =
      health.status === "empty"
        ? `Navigated to ${action.params.url}, but page appears empty. ${health.warning ?? ""}`.trim()
        : `Navigation to ${action.params.url} reported ${health.status}. ${health.warning ?? ""}`.trim();
    return fail(warning, {
      longTermMemory: `Navigation warning for ${action.params.url}`,
      data: { navigation: health },
      activeTargetId: newTab ? targetPage.targetId : undefined,
    });
  }
  const memory = newTab
    ? `Opened new tab and navigated to ${action.params.url}`
    : `Navigated to ${action.params.url}`;
  return ok(memory, {
    data: { navigation: health },
    activeTargetId: newTab ? targetPage.targetId : undefined,
  });
}

export async function handleGoBack(ctx: HandlerContext): Promise<ActionResult> {
  const wentBack = await ctx.page.goBack();
  return wentBack ? ok("Navigated back") : fail("Cannot go back — no previous history entry");
}

export async function handleGoForward(ctx: HandlerContext): Promise<ActionResult> {
  const wentForward = await ctx.page.goForward();
  return wentForward ? ok("Navigated forward") : fail("Cannot go forward — no next history entry");
}

export async function handleRefresh(ctx: HandlerContext): Promise<ActionResult> {
  await ctx.page.refresh();
  return ok("Refreshed page");
}

export async function handleNewTab(
  ctx: HandlerContext,
  action: ByName<"new_tab">,
): Promise<ActionResult> {
  const session = requireSession(ctx.session, action.name);
  const tab = await session.newPage();
  if (action.params.url) {
    const health = await tab.navigateWithHealthCheck(action.params.url);
    if (!health.ok) {
      const warning =
        `Opened new tab, but navigation to ${action.params.url} reported ${health.status}. ${health.warning ?? ""}`.trim();
      return fail(warning, { data: { navigation: health }, activeTargetId: tab.targetId });
    }
    return ok(`Opened new tab ${tab.targetId} with ${action.params.url}`, {
      longTermMemory: `Opened new tab ${tab.targetId}`,
      data: { navigation: health },
      activeTargetId: tab.targetId,
    });
  }
  return ok(`Opened new tab ${tab.targetId}`, {
    longTermMemory: `Opened new tab ${tab.targetId}`,
    activeTargetId: tab.targetId,
  });
}

export async function handleSwitchTab(
  ctx: HandlerContext,
  action: ByName<"switch_tab">,
): Promise<ActionResult> {
  const session = requireSession(ctx.session, action.name);
  const targetIds = await session.listPageTargetIds();
  let resolvedTargetId = action.params.targetId;
  if (typeof action.params.pageId === "number") {
    resolvedTargetId = targetIds[action.params.pageId];
  }
  if (!resolvedTargetId || !targetIds.includes(resolvedTargetId)) {
    return fail(
      typeof action.params.pageId === "number"
        ? `Tab pageId ${action.params.pageId} not found`
        : `Tab not found: ${action.params.targetId}`,
    );
  }
  return ok(`Switched to tab ${resolvedTargetId}`, {
    longTermMemory: `Switched tab to ${resolvedTargetId}`,
    activeTargetId: resolvedTargetId,
  });
}

export async function handleCloseTab(
  ctx: HandlerContext,
  action: ByName<"close_tab">,
): Promise<ActionResult> {
  const session = requireSession(ctx.session, action.name);
  const targetIds = await session.listPageTargetIds();
  const closingTargetId =
    action.params.targetId ??
    (typeof action.params.pageId === "number" ? targetIds[action.params.pageId] : undefined) ??
    ctx.page.targetId;

  if (!closingTargetId || !targetIds.includes(closingTargetId)) {
    return fail(
      typeof action.params.pageId === "number"
        ? `Tab pageId ${action.params.pageId} not found`
        : `Tab not found: ${action.params.targetId}`,
    );
  }

  await session.closePage(closingTargetId);
  const remaining = await session.listPageTargetIds();
  if (remaining.length === 0) {
    const replacement = await session.newPage();
    return ok(`Closed tab ${closingTargetId}; opened replacement ${replacement.targetId}`, {
      longTermMemory: `Closed tab ${closingTargetId}`,
      activeTargetId: replacement.targetId,
    });
  }
  const next = remaining[0] as string;
  return ok(`Closed tab ${closingTargetId}`, {
    longTermMemory: `Closed tab ${closingTargetId}`,
    activeTargetId: next,
  });
}

interface FrameTreeNode {
  frame: { id: string; url?: string; name?: string };
  childFrames?: FrameTreeNode[];
}

function flattenFrames(node: FrameTreeNode): FrameTreeNode["frame"][] {
  const out: FrameTreeNode["frame"][] = [node.frame];
  for (const child of node.childFrames ?? []) out.push(...flattenFrames(child));
  return out;
}

export async function handleSwitchFrame(
  ctx: HandlerContext,
  action: ByName<"switch_frame">,
): Promise<ActionResult> {
  if (!action.params.frameId && typeof action.params.index !== "number") {
    ctx.page.currentFrameId = undefined;
    return ok("Switched back to main frame", { longTermMemory: "Switched to main frame" });
  }
  const tree = await ctx.page.sendCDP<{ frameTree: FrameTreeNode }>("Page.getFrameTree");
  const frames = flattenFrames(tree.frameTree);
  let chosen: FrameTreeNode["frame"] | undefined;
  if (action.params.frameId) {
    chosen = frames.find((f) => f.id === action.params.frameId);
  } else if (typeof action.params.index === "number") {
    chosen = frames[action.params.index];
  }
  if (!chosen) {
    const list = frames.map((f, i) => `${i}:${f.id}${f.url ? ` (${f.url})` : ""}`).join("; ");
    return fail(`Frame not found. Available: ${list}`);
  }
  ctx.page.currentFrameId = chosen.id;
  return ok(`Switched to frame ${chosen.id}${chosen.url ? ` (${chosen.url})` : ""}`, {
    longTermMemory: `Switched to frame ${chosen.id}`,
  });
}

export async function handleCloseBrowser(
  ctx: HandlerContext,
  action: ByName<"close_browser">,
): Promise<ActionResult> {
  const session = requireSession(ctx.session, action.name);
  await session.close();
  return ok("Closed browser session");
}
