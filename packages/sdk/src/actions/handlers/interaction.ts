import { existsSync, statSync } from "node:fs";

import type { Action } from "../types";
import {
  fail,
  ok,
  resolveActionPage,
  resolveBackendId,
  resolveByLocator,
  staleMessage,
  substituteSecrets,
  type ActionResult,
  type HandlerContext,
  type Locator,
} from "./shared";
import type { ElementInfo } from "../../dom/types";

type ByName<N extends Action["name"]> = Extract<Action, { name: N }>;

export async function handleClick(
  ctx: HandlerContext,
  action: ByName<"click">,
): Promise<ActionResult> {
  const detectMs = ctx.newTabDetectMs ?? 500;
  // Subscribe BEFORE click so Target.attachedToTarget cannot race. Filter by openerId.
  const tabWatch =
    ctx.session && detectMs > 0
      ? ctx.session.waitForNewPageTarget(detectMs, ctx.page.targetId)
      : null;

  const subject =
    typeof action.params.index === "number"
      ? `element [${action.params.index}]`
      : `coordinates (${action.params.coordinateX}, ${action.params.coordinateY})`;

  const finalizeOk = async (): Promise<ActionResult> => {
    const target = tabWatch ? await tabWatch : null;
    if (target && target !== ctx.page.targetId) {
      return ok(`Clicked ${subject} — switched to new tab ${target}`, {
        longTermMemory: `Clicked ${subject} and switched to new tab ${target}`,
        activeTargetId: target,
      });
    }
    return ok(`Clicked ${subject}`, { longTermMemory: `Clicked ${subject}` });
  };

  if (
    typeof action.params.coordinateX === "number" &&
    typeof action.params.coordinateY === "number"
  ) {
    await ctx.page.clickAtCoordinates(action.params.coordinateX, action.params.coordinateY);
    return finalizeOk();
  }

  if (typeof action.params.index !== "number") {
    return fail("Click action requires index or coordinateX+coordinateY");
  }

  const resolved = resolveBackendId(ctx.selectorMap, action.params.index);
  if (!resolved.ok) return fail(resolved.message);
  const targetPage = resolveActionPage(ctx, resolved.targetId);
  const result = await targetPage.clickByBackendNodeId(resolved.backendNodeId);
  if (!result.ok) return fail(staleMessage(action.params.index));
  return finalizeOk();
}

export async function handleFocus(
  ctx: HandlerContext,
  action: ByName<"focus">,
): Promise<ActionResult> {
  const resolved = resolveBackendId(ctx.selectorMap, action.params.index);
  if (!resolved.ok) return fail(resolved.message);
  const result = await resolveActionPage(ctx, resolved.targetId).focusByBackendNodeId(
    resolved.backendNodeId,
  );
  if (result.ok) return ok(`Focused [${action.params.index}]`);
  if (result.reason === "index_stale") return fail(staleMessage(action.params.index));
  return fail(`Element [${action.params.index}] not focusable`);
}

function findElementByIndex(
  ctx: HandlerContext,
  index: number,
): { ok: true; element: ElementInfo } | { ok: false; result: ActionResult } {
  const elements = ctx.snapshotElements ?? [];
  const el = elements.find((e) => e.index === index);
  if (!el) {
    return { ok: false, result: fail(`Index [${index}] is not present in the current snapshot`) };
  }
  if (el.bbox.w <= 0 || el.bbox.h <= 0) {
    return { ok: false, result: fail(`Element [${index}] has no visible bbox`) };
  }
  return { ok: true, element: el };
}

export async function handleHover(
  ctx: HandlerContext,
  action: ByName<"hover">,
): Promise<ActionResult> {
  const resolved = findElementByIndex(ctx, action.params.index);
  if (!resolved.ok) return resolved.result;
  const { bbox } = resolved.element;
  const x = bbox.x + bbox.w / 2;
  const y = bbox.y + bbox.h / 2;
  await ctx.page.sendCDP("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    clickCount: 0,
  });
  return ok(`Hovered [${action.params.index}]`, {
    longTermMemory: `Hovered [${action.params.index}]`,
  });
}

export async function handleDblclick(
  ctx: HandlerContext,
  action: ByName<"dblclick">,
): Promise<ActionResult> {
  const resolved = findElementByIndex(ctx, action.params.index);
  if (!resolved.ok) return resolved.result;
  const { bbox } = resolved.element;
  const x = bbox.x + bbox.w / 2;
  const y = bbox.y + bbox.h / 2;
  await ctx.page.sendCDP("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    clickCount: 0,
  });
  await ctx.page.sendCDP("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 2,
  });
  await ctx.page.sendCDP("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 2,
  });
  return ok(`Double-clicked [${action.params.index}]`, {
    longTermMemory: `Double-clicked [${action.params.index}]`,
  });
}

export async function handleType(
  ctx: HandlerContext,
  action: ByName<"type">,
): Promise<ActionResult> {
  const resolved = resolveBackendId(ctx.selectorMap, action.params.index);
  if (!resolved.ok) return fail(resolved.message);

  const sub = substituteSecrets(action.params.text, ctx.sensitiveData);
  if (!sub.ok) {
    return fail(`Type aborted: unknown secret placeholder <secret>${sub.key}</secret>`);
  }

  const result = await resolveActionPage(ctx, resolved.targetId).typeByBackendNodeId(
    resolved.backendNodeId,
    sub.value,
    action.params.submit ?? false,
    action.params.mode,
  );
  if (result.ok) {
    const summary = `Typed into [${action.params.index}]${
      action.params.mode === "append" ? " (appended)" : ""
    }${action.params.submit ? " and submitted" : ""}`;
    return ok(summary, { longTermMemory: `Typed into [${action.params.index}]` });
  }
  if (result.reason === "index_stale") return fail(staleMessage(action.params.index));
  if (result.reason === "not_typable") return fail(`Element [${action.params.index}] not typable`);
  return fail(`Element [${action.params.index}] failed value verification`);
}

export async function handleFill(
  ctx: HandlerContext,
  action: ByName<"fill">,
): Promise<ActionResult> {
  const result = await handleType(ctx, {
    name: "type",
    params: {
      index: action.params.index,
      text: action.params.text,
      submit: action.params.submit,
      mode: "replace",
    },
  });
  if (!result.ok) return result;
  return ok(`Filled [${action.params.index}]${action.params.submit ? " and submitted" : ""}`, {
    longTermMemory: `Filled [${action.params.index}]`,
  });
}

export async function handleScroll(
  ctx: HandlerContext,
  action: ByName<"scroll">,
): Promise<ActionResult> {
  const pages = action.params.pages ?? (action.params.amount ? action.params.amount / 1000 : 1.0);
  let backendNodeId: number | undefined;
  let scrollPage = ctx.page;
  if (typeof action.params.index === "number") {
    const resolved = resolveBackendId(ctx.selectorMap, action.params.index);
    if (!resolved.ok) return fail(resolved.message);
    backendNodeId = resolved.backendNodeId;
    scrollPage = resolveActionPage(ctx, resolved.targetId);
  }
  const result = await scrollPage.scrollByPages(action.params.direction, pages, backendNodeId);
  if (!result.ok) return fail(staleMessage(action.params.index ?? -1));
  return ok(
    `Scrolled ${action.params.direction}${action.params.index !== undefined ? ` on [${action.params.index}]` : ""}`,
  );
}

export async function handleSendKeys(
  ctx: HandlerContext,
  action: ByName<"send_keys">,
): Promise<ActionResult> {
  await ctx.page.sendKeys(action.params.keys);
  return ok(`Sent keys: ${action.params.keys}`);
}

export async function handlePress(
  ctx: HandlerContext,
  action: ByName<"press">,
): Promise<ActionResult> {
  await ctx.page.pressKey(action.params.key);
  return ok(`Pressed key: ${action.params.key}`);
}

export async function handleKeyboardType(
  ctx: HandlerContext,
  action: ByName<"keyboard_type">,
): Promise<ActionResult> {
  const sub = substituteSecrets(action.params.text, ctx.sensitiveData);
  if (!sub.ok) {
    return fail(`Keyboard type aborted: unknown secret placeholder <secret>${sub.key}</secret>`);
  }
  await ctx.page.keyboardType(sub.value);
  return ok("Typed text with keyboard input");
}

export async function handleSelectOption(
  ctx: HandlerContext,
  action: ByName<"select_option">,
): Promise<ActionResult> {
  const resolved = resolveBackendId(ctx.selectorMap, action.params.index);
  if (!resolved.ok) return fail(resolved.message);
  const result = await resolveActionPage(ctx, resolved.targetId).selectOptionByBackendNodeId(
    resolved.backendNodeId,
    action.params.value,
  );
  if (result.ok) {
    return ok(`Selected option on [${action.params.index}]`, {
      longTermMemory: `Selected option on [${action.params.index}]`,
    });
  }
  return fail(
    result.reason === "index_stale"
      ? staleMessage(action.params.index)
      : `Could not select option on [${action.params.index}]`,
  );
}

/** Route locator-resolved elements to their owning target (OOPIF support). */
function pageForElement(ctx: HandlerContext, element: ElementInfo) {
  const entry = ctx.selectorMap?.byIndex.get(element.index);
  return resolveActionPage(ctx, entry?.targetId);
}

function resolveLocatorForAction(
  ctx: HandlerContext,
  locator: Locator,
): { ok: true; element: ElementInfo; matchedBy: string } | { ok: false; result: ActionResult } {
  const elements = ctx.snapshotElements ?? [];
  if (elements.length === 0) {
    return {
      ok: false,
      result: fail("No snapshot elements available; call focus_area or wait for re-observation."),
    };
  }
  const resolved = resolveByLocator(locator, elements);
  if (!resolved.ok) {
    return { ok: false, result: fail(`Locator ${resolved.reason}: ${resolved.message}`) };
  }
  return { ok: true, element: resolved.element, matchedBy: resolved.matchedBy };
}

export async function handleClickBy(
  ctx: HandlerContext,
  action: ByName<"click_by">,
): Promise<ActionResult> {
  const resolved = resolveLocatorForAction(ctx, action.params.locator);
  if (!resolved.ok) return resolved.result;
  const detectMs = ctx.newTabDetectMs ?? 500;
  const tabWatch =
    ctx.session && detectMs > 0
      ? ctx.session.waitForNewPageTarget(detectMs, ctx.page.targetId)
      : null;
  const result = await pageForElement(ctx, resolved.element).clickByBackendNodeId(
    resolved.element.backendNodeId,
  );
  if (!result.ok) return fail(staleMessage(resolved.element.index));
  const target = tabWatch ? await tabWatch : null;
  const subject = `${resolved.matchedBy} ([${resolved.element.index}])`;
  if (target && target !== ctx.page.targetId) {
    return ok(`Clicked ${subject} — switched to new tab ${target}`, {
      longTermMemory: `Clicked ${subject} and switched to new tab ${target}`,
      activeTargetId: target,
    });
  }
  return ok(`Clicked ${subject}`, { longTermMemory: `Clicked ${subject}` });
}

export async function handleTypeBy(
  ctx: HandlerContext,
  action: ByName<"type_by">,
): Promise<ActionResult> {
  const resolved = resolveLocatorForAction(ctx, action.params.locator);
  if (!resolved.ok) return resolved.result;
  const sub = substituteSecrets(action.params.text, ctx.sensitiveData);
  if (!sub.ok) {
    return fail(`Type aborted: unknown secret placeholder <secret>${sub.key}</secret>`);
  }
  const result = await pageForElement(ctx, resolved.element).typeByBackendNodeId(
    resolved.element.backendNodeId,
    sub.value,
    action.params.submit ?? false,
    action.params.mode,
  );
  const subject = `${resolved.matchedBy} ([${resolved.element.index}])`;
  if (result.ok) {
    const summary = `Typed into ${subject}${
      action.params.mode === "append" ? " (appended)" : ""
    }${action.params.submit ? " and submitted" : ""}`;
    return ok(summary, { longTermMemory: `Typed into ${subject}` });
  }
  if (result.reason === "index_stale") return fail(staleMessage(resolved.element.index));
  if (result.reason === "not_typable") return fail(`${subject} not typable`);
  return fail(`${subject} failed value verification`);
}

export async function handleSelectBy(
  ctx: HandlerContext,
  action: ByName<"select_by">,
): Promise<ActionResult> {
  const resolved = resolveLocatorForAction(ctx, action.params.locator);
  if (!resolved.ok) return resolved.result;
  const result = await pageForElement(ctx, resolved.element).selectOptionByBackendNodeId(
    resolved.element.backendNodeId,
    action.params.value,
  );
  const subject = `${resolved.matchedBy} ([${resolved.element.index}])`;
  if (result.ok) {
    return ok(`Selected option on ${subject}`, {
      longTermMemory: `Selected option on ${subject}`,
    });
  }
  return fail(
    result.reason === "index_stale"
      ? staleMessage(resolved.element.index)
      : `Could not select option on ${subject}`,
  );
}

export async function handleUploadFile(
  ctx: HandlerContext,
  action: ByName<"upload_file">,
): Promise<ActionResult> {
  for (const path of action.params.paths) {
    if (!existsSync(path)) return fail(`Upload aborted: file not found: ${path}`);
    try {
      if (!statSync(path).isFile()) return fail(`Upload aborted: path is not a file: ${path}`);
    } catch {
      return fail(`Upload aborted: cannot stat path: ${path}`);
    }
  }

  const resolved = resolveBackendId(ctx.selectorMap, action.params.index);
  if (!resolved.ok) return fail(resolved.message);
  const targetPage = resolveActionPage(ctx, resolved.targetId);

  const nearest = await targetPage.findNearestFileInputBackendNodeId(resolved.backendNodeId);
  let inputBackendNodeId: number;
  let viaFallback = false;
  if (nearest.ok) {
    inputBackendNodeId = nearest.backendNodeId;
  } else {
    if (nearest.reason === "index_stale") return fail(staleMessage(action.params.index));
    // Proximity walk found nothing — fall back to the document's sole
    // file input (visible or hidden). Skipped when zero or multiple exist.
    const sole = await targetPage.findSoleFileInputBackendNodeId();
    if (!sole.ok) {
      return fail(`Could not find a file input near element [${action.params.index}]`);
    }
    inputBackendNodeId = sole.backendNodeId;
    viaFallback = true;
  }

  const result = await targetPage.uploadFilesByBackendNodeId(
    inputBackendNodeId,
    action.params.paths,
  );
  const target = viaFallback
    ? `the page's only file input (none found near [${action.params.index}])`
    : `[${action.params.index}]`;
  return result.ok
    ? ok(`Uploaded ${action.params.paths.length} file(s) to ${target}`, {
        longTermMemory: `Uploaded file(s) to ${target}`,
      })
    : fail(staleMessage(action.params.index));
}
