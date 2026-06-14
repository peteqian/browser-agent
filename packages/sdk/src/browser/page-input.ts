import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "./page";
import type { RuntimeExceptionDetails } from "./session-types";
import {
  clickHoldDelayMs,
  mousePathPoints,
  mouseStepDelayMs,
  resolveHumanize,
  typingDelaysMs,
  type ResolvedHumanize,
} from "./humanize";

// Last synthetic cursor position per page, so consecutive humanized clicks
// start their path where the previous one landed.
const lastMousePosition = new WeakMap<Page, { x: number; y: number }>();

function pageHumanize(page: Page): ResolvedHumanize | null {
  return resolveHumanize(page.session.profile.humanize);
}

export async function clickByBackendNodeId(
  page: Page,
  backendNodeId: number,
): Promise<{ ok: true } | { ok: false; reason: "index_stale" }> {
  const direct = await clickDirectForFormControl(page, backendNodeId);
  if (direct.ok) return { ok: true };
  if (direct.reason === "index_stale") return { ok: false, reason: "index_stale" };

  const point = await clickPointForBackendNode(page, backendNodeId);
  if (point.ok) {
    await clickAtCoordinates(page, point.x, point.y);
    return { ok: true };
  }

  const result = await page.callOnBackendNode<void>(
    backendNodeId,
    `function() {
      this.scrollIntoView({ block: "center", inline: "center" });
      if (typeof this.click === "function") { this.click(); return; }
      this.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    }`,
  );
  return result.ok ? { ok: true } : { ok: false, reason: "index_stale" };
}

async function clickDirectForFormControl(
  page: Page,
  backendNodeId: number,
): Promise<{ ok: true } | { ok: false; reason: "not_form_control" | "index_stale" }> {
  const result = await page.callOnBackendNode<"clicked" | "not_form_control">(
    backendNodeId,
    `function() {
      const tag = this.tagName;
      const type = String(this.type || "").toLowerCase();
      const isNativeChoice = tag === "INPUT" && (type === "checkbox" || type === "radio");
      if (!isNativeChoice) {
        return "not_form_control";
      }
      this.scrollIntoView({ block: "center", inline: "center" });
      const label = this.closest("label") || (this.id ? document.querySelector(\`label[for="\${CSS.escape(this.id)}"]\`) : null);
      if (label && typeof label.click === "function") label.click();
      else this.click();
      return "clicked";
    }`,
  );
  if (!result.ok) return { ok: false, reason: "index_stale" };
  return result.value === "clicked" ? { ok: true } : { ok: false, reason: "not_form_control" };
}

async function clickPointForBackendNode(
  page: Page,
  backendNodeId: number,
): Promise<{ ok: true; x: number; y: number } | { ok: false }> {
  const rect = await page.callOnBackendNode<{
    x: number;
    y: number;
    width: number;
    height: number;
    right: number;
    bottom: number;
  }>(
    backendNodeId,
    `function() {
      const read = () => {
        const r = this.getBoundingClientRect();
        return {
          x: r.left,
          y: r.top,
          width: r.width,
          height: r.height,
          right: r.right,
          bottom: r.bottom,
        };
      };
      let r = read();
      const visible =
        r.width > 0 &&
        r.height > 0 &&
        r.x >= 0 &&
        r.y >= 0 &&
        r.right <= window.innerWidth &&
        r.bottom <= window.innerHeight;
      if (!visible) {
        this.scrollIntoView({ block: "center", inline: "center" });
        r = read();
      }
      return r;
    }`,
  );
  if (!rect.ok) return { ok: false };
  if (!rect.value || typeof rect.value !== "object") return { ok: false };
  const x = rect.value.x + rect.value.width / 2;
  const y = rect.value.y + rect.value.height / 2;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return { ok: false };
  return { ok: true, x, y };
}

export async function clickAtCoordinates(page: Page, x: number, y: number): Promise<void> {
  const humanize = pageHumanize(page);
  if (humanize?.mouse) {
    await humanClickAtCoordinates(page, x, y, humanize);
    return;
  }
  await page.sendCDP("Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    clickCount: 0,
  });
  await page.sendCDP("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await page.sendCDP("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  lastMousePosition.set(page, { x, y });
}

/**
 * Click via a curved mouse path with eased step timing and a held press.
 * Used by `clickAtCoordinates` when the profile opts into humanize, and
 * directly by the challenge watchdog (which always humanizes).
 */
export async function humanClickAtCoordinates(
  page: Page,
  x: number,
  y: number,
  humanize?: ResolvedHumanize,
): Promise<void> {
  const resolved = humanize ?? resolveHumanize(true)!;
  const from = lastMousePosition.get(page) ?? {
    x: x + (resolved.rng() - 0.5) * 400,
    y: Math.max(0, y - 200 - resolved.rng() * 200),
  };
  const points = mousePathPoints(from, { x, y }, resolved.rng);
  for (let i = 0; i < points.length; i++) {
    const point = points[i]!;
    await page.sendCDP("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: point.x,
      y: point.y,
      button: "none",
      clickCount: 0,
    });
    const stepDelay = mouseStepDelayMs(i + 1, points.length, resolved.speed, resolved.rng);
    if (stepDelay > 0) await delay(stepDelay);
  }
  await page.sendCDP("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  const hold = clickHoldDelayMs(resolved.speed, resolved.rng);
  if (hold > 0) await delay(hold);
  await page.sendCDP("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  lastMousePosition.set(page, { x, y });
}

export async function focusByBackendNodeId(
  page: Page,
  backendNodeId: number,
): Promise<
  { ok: true } | { ok: false; reason: "index_stale" } | { ok: false; reason: "not_typable" }
> {
  const result = await focusTypableByBackendNodeId(page, backendNodeId, "keep");
  if (!result.ok) return result;
  return { ok: true };
}

export async function typeByBackendNodeId(
  page: Page,
  backendNodeId: number,
  text: string,
  submit = false,
  mode: "replace" | "append" = "replace",
): Promise<
  | { ok: true }
  | { ok: false; reason: "index_stale" }
  | { ok: false; reason: "not_typable" }
  | { ok: false; reason: "value_mismatch" }
> {
  const focused = await focusTypableByBackendNodeId(
    page,
    backendNodeId,
    mode === "replace" ? "clear" : "keep",
  );
  if (!focused.ok) return focused;

  const point = await clickPointForBackendNode(page, backendNodeId);
  if (point.ok) {
    await clickAtCoordinates(page, point.x, point.y);
    if (mode === "replace") await clearActiveElement(page);
  }

  await keyboardType(page, text);
  if (submit) await pressKey(page, "Enter");

  const actual = await readTypableValue(page, backendNodeId);
  if (!actual.ok) return actual;
  if (mode === "replace" && actual.value !== text) {
    return { ok: false, reason: "value_mismatch" };
  }
  if (mode === "append" && !actual.value.endsWith(text)) {
    return { ok: false, reason: "value_mismatch" };
  }
  return { ok: true };
}

async function focusTypableByBackendNodeId(
  page: Page,
  backendNodeId: number,
  mode: "clear" | "keep",
): Promise<
  { ok: true } | { ok: false; reason: "index_stale" } | { ok: false; reason: "not_typable" }
> {
  type FocusJsResult = "not_typable" | { kind: "ok" };
  const result = await page.callOnBackendNode<FocusJsResult>(
    backendNodeId,
    `function(mode) {
      const findTypable = (el) => {
        const tag = el.tagName;
        const isInputLike = tag === "INPUT" || tag === "TEXTAREA";
        if (isInputLike || el.isContentEditable) return el;
        if (!el.querySelector) return null;
        return el.querySelector("input:not([type='hidden']), textarea, [contenteditable='true']");
      };
      const target = findTypable(this);
      if (!target) return "not_typable";
      const tag = target.tagName;
      target.scrollIntoView({ block: "center", inline: "center" });
      target.focus();
      const setValue = (v) => {
        if (target.isContentEditable) { target.textContent = v; return; }
        const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        const setter = desc && desc.set;
        if (setter) setter.call(target, v); else target.value = v;
      };
      if (mode === "clear") {
        try { if (typeof target.select === "function") target.select(); } catch (_) {}
        setValue("");
        target.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
        target.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return { kind: "ok" };
    }`,
    [mode],
  );
  if (!result.ok) {
    if (result.reason === "index_stale") return { ok: false, reason: "index_stale" };
    return { ok: false, reason: "not_typable" };
  }
  if (result.value === "not_typable") return { ok: false, reason: "not_typable" };
  return { ok: true };
}

async function readTypableValue(
  page: Page,
  backendNodeId: number,
): Promise<
  | { ok: true; value: string }
  | { ok: false; reason: "index_stale" }
  | { ok: false; reason: "not_typable" }
> {
  const result = await page.callOnBackendNode<string | "not_typable">(
    backendNodeId,
    `function() {
      const findTypable = (el) => {
        const tag = el.tagName;
        const isInputLike = tag === "INPUT" || tag === "TEXTAREA";
        if (isInputLike || el.isContentEditable) return el;
        if (!el.querySelector) return null;
        return el.querySelector("input:not([type='hidden']), textarea, [contenteditable='true']");
      };
      const target = findTypable(this);
      if (!target) return "not_typable";
      return target.isContentEditable ? (target.textContent || "") : (target.value || "");
    }`,
  );
  if (!result.ok) {
    if (result.reason === "index_stale") return { ok: false, reason: "index_stale" };
    return { ok: false, reason: "not_typable" };
  }
  if (result.value === "not_typable") return { ok: false, reason: "not_typable" };
  return { ok: true, value: result.value };
}

export async function selectOptionByBackendNodeId(
  page: Page,
  backendNodeId: number,
  valueOrLabel: string,
): Promise<
  { ok: true } | { ok: false; reason: "index_stale" } | { ok: false; reason: "no_match" }
> {
  const result = await page.callOnBackendNode<"ok" | "no_match" | "wrong_tag">(
    backendNodeId,
    `function(target) {
      if (this.tagName !== "SELECT") return "wrong_tag";
      const options = Array.from(this.options || []);
      const byValue = options.find((opt) => opt.value === target);
      const byLabel = options.find((opt) => (opt.label || opt.textContent || "").trim() === target);
      const match = byValue || byLabel;
      if (!match) return "no_match";
      this.value = match.value;
      this.dispatchEvent(new Event("input", { bubbles: true }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
      return "ok";
    }`,
    [valueOrLabel],
  );
  if (!result.ok) return { ok: false, reason: "index_stale" };
  if (result.value !== "ok") return { ok: false, reason: "no_match" };
  return { ok: true };
}

export async function sendKeys(page: Page, keys: string): Promise<void> {
  const tokens = keys
    .split("+")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
  if (tokens.length === 0) throw new Error("sendKeys requires non-empty key string");

  const modifiers = new Set<string>();
  for (const token of tokens.slice(0, -1)) {
    const normalized = token.toLowerCase();
    if (normalized === "control" || normalized === "ctrl") modifiers.add("Control");
    if (normalized === "shift") modifiers.add("Shift");
    if (normalized === "alt") modifiers.add("Alt");
    if (normalized === "meta" || normalized === "command") modifiers.add("Meta");
  }

  const modifierMask =
    (modifiers.has("Alt") ? 1 : 0) |
    (modifiers.has("Control") ? 2 : 0) |
    (modifiers.has("Meta") ? 4 : 0) |
    (modifiers.has("Shift") ? 8 : 0);

  const mainKey = tokens[tokens.length - 1] as string;

  for (const modifier of modifiers) {
    await page.sendCDP("Input.dispatchKeyEvent", {
      type: "keyDown",
      key: modifier,
      modifiers: modifierMask,
    });
  }
  await page.sendCDP("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: mainKey,
    modifiers: modifierMask,
  });
  await page.sendCDP("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: mainKey,
    modifiers: modifierMask,
  });
  for (const modifier of Array.from(modifiers).toReversed()) {
    await page.sendCDP("Input.dispatchKeyEvent", {
      type: "keyUp",
      key: modifier,
      modifiers: modifierMask,
    });
  }
}

export async function pressKey(page: Page, key: string): Promise<void> {
  await sendKeys(page, key);
}

export async function keyboardType(page: Page, text: string): Promise<void> {
  const humanize = pageHumanize(page);
  const delays = humanize?.typing ? typingDelaysMs(text, humanize.speed, humanize.rng) : null;
  const chars = Array.from(text);
  for (let i = 0; i < chars.length; i++) {
    const char = chars[i]!;
    await page.sendCDP("Input.dispatchKeyEvent", {
      type: "char",
      text: char,
      unmodifiedText: char,
    });
    const wait = delays?.[i] ?? 0;
    if (wait > 0) await delay(wait);
  }
}

async function clearActiveElement(page: Page): Promise<void> {
  await page.sendCDP("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "a",
    code: "KeyA",
    modifiers: 2,
  });
  await page.sendCDP("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "a",
    code: "KeyA",
    modifiers: 2,
  });
  await page.sendCDP("Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Backspace",
    code: "Backspace",
  });
  await page.sendCDP("Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Backspace",
    code: "Backspace",
  });
}

/**
 * Walk the DOM near `backendNodeId` looking for the closest
 * `<input type="file">`: self first, then descendants, then ancestors
 * up to 4 levels or the enclosing `<form>`.
 */
export async function findNearestFileInputBackendNodeId(
  page: Page,
  backendNodeId: number,
): Promise<
  | { ok: true; backendNodeId: number }
  | { ok: false; reason: "index_stale" }
  | { ok: false; reason: "no_file_input" }
> {
  const objectId = await page.resolveBackendNode(backendNodeId);
  if (!objectId) return { ok: false, reason: "index_stale" };
  try {
    const res = await page.sendCDP<{
      result: { objectId?: string; subtype?: string };
      exceptionDetails?: RuntimeExceptionDetails;
    }>("Runtime.callFunctionOn", {
      functionDeclaration: `function() {
        const isFileInput = (el) => el && el.tagName === "INPUT" && el.type === "file";
        if (isFileInput(this)) return this;
        if (this.querySelector) {
          const inside = this.querySelector('input[type="file"]');
          if (inside) return inside;
        }
        let node = this;
        for (let i = 0; i < 4 && node.parentElement; i++) {
          node = node.parentElement;
          if (node.querySelector) {
            const found = node.querySelector('input[type="file"]');
            if (found) return found;
          }
          if (node.tagName === "FORM") break;
        }
        return null;
      }`,
      objectId,
      returnByValue: false,
      awaitPromise: false,
    });
    if (res.exceptionDetails || !res.result.objectId) {
      return { ok: false, reason: "no_file_input" };
    }
    const foundObjectId = res.result.objectId;
    try {
      const desc = await page.sendCDP<{ node?: { backendNodeId?: number } }>("DOM.describeNode", {
        objectId: foundObjectId,
      });
      const found = desc.node?.backendNodeId;
      if (typeof found !== "number") return { ok: false, reason: "no_file_input" };
      return { ok: true, backendNodeId: found };
    } finally {
      await page.releaseObject(foundObjectId);
    }
  } finally {
    await page.releaseObject(objectId);
  }
}

/**
 * Document-wide fallback for `findNearestFileInputBackendNodeId`: when the
 * proximity walk finds nothing, look for `input[type="file"]` anywhere in the
 * document (visible or hidden — upload widgets routinely hide the real
 * input). Only succeeds when exactly one exists, so we never guess between
 * multiple unrelated inputs.
 */
export async function findSoleFileInputBackendNodeId(
  page: Page,
): Promise<{ ok: true; backendNodeId: number } | { ok: false; reason: "no_file_input" }> {
  let objectId: string;
  try {
    objectId = await page.evaluateHandle(`(() => {
      const inputs = document.querySelectorAll('input[type="file"]');
      return inputs.length === 1 ? inputs[0] : null;
    })()`);
  } catch {
    return { ok: false, reason: "no_file_input" };
  }
  try {
    const desc = await page.sendCDP<{ node?: { backendNodeId?: number } }>("DOM.describeNode", {
      objectId,
    });
    const found = desc.node?.backendNodeId;
    if (typeof found !== "number") return { ok: false, reason: "no_file_input" };
    return { ok: true, backendNodeId: found };
  } catch {
    return { ok: false, reason: "no_file_input" };
  } finally {
    await page.releaseObject(objectId);
  }
}

export async function uploadFilesByBackendNodeId(
  page: Page,
  backendNodeId: number,
  filePaths: string[],
): Promise<{ ok: true } | { ok: false; reason: "index_stale" }> {
  if (filePaths.length === 0) {
    throw new Error("uploadFilesByBackendNodeId requires at least one file path");
  }
  try {
    await page.sendCDP("DOM.setFileInputFiles", { backendNodeId, files: filePaths });
    return { ok: true };
  } catch {
    return { ok: false, reason: "index_stale" };
  }
}

export async function scroll(
  page: Page,
  direction: "up" | "down" | "top" | "bottom",
  amount = 800,
  backendNodeId?: number,
): Promise<{ ok: true } | { ok: false; reason: "index_stale" }> {
  if (backendNodeId === undefined) {
    const expr =
      direction === "up"
        ? `window.scrollBy(0, -${amount})`
        : direction === "down"
          ? `window.scrollBy(0, ${amount})`
          : direction === "top"
            ? "window.scrollTo(0, 0)"
            : "window.scrollTo(0, document.body.scrollHeight)";
    await page.evaluate(expr);
    return { ok: true };
  }

  const fnBody =
    direction === "up"
      ? `function(amount) { this.scrollBy(0, -amount); }`
      : direction === "down"
        ? `function(amount) { this.scrollBy(0, amount); }`
        : direction === "top"
          ? `function() { this.scrollTop = 0; }`
          : `function() { this.scrollTop = this.scrollHeight; }`;

  const result = await page.callOnBackendNode<void>(backendNodeId, fnBody, [amount]);
  return result.ok ? { ok: true } : { ok: false, reason: "index_stale" };
}

export async function scrollByPages(
  page: Page,
  direction: "up" | "down" | "top" | "bottom",
  pages = 1.0,
  backendNodeId?: number,
): Promise<{ ok: true } | { ok: false; reason: "index_stale" }> {
  const viewportHeight = await page
    .evaluate<number>("window.innerHeight || 1000")
    .catch(() => 1000);
  if (direction === "top" || direction === "bottom") {
    return scroll(page, direction, viewportHeight, backendNodeId);
  }

  const fullPages = Math.max(0, Math.floor(pages));
  const fractional = Math.max(0, pages - fullPages);

  for (let i = 0; i < fullPages; i += 1) {
    const r = await scroll(page, direction, viewportHeight, backendNodeId);
    if (!r.ok) return r;
    await delay(150);
  }
  if (fractional > 0) {
    const r = await scroll(
      page,
      direction,
      Math.max(1, Math.floor(fractional * viewportHeight)),
      backendNodeId,
    );
    if (!r.ok) return r;
  }
  return { ok: true };
}

export async function getDropdownOptionsByBackendNodeId(
  page: Page,
  backendNodeId: number,
): Promise<Array<{ value: string; text: string }>> {
  const result = await page.callOnBackendNode<Array<{ value: string; text: string }>>(
    backendNodeId,
    `function() {
      if (this.tagName !== "SELECT") return [];
      const out = [];
      for (const option of Array.from(this.options || [])) {
        out.push({ value: option.value, text: (option.label || option.textContent || "").trim() });
      }
      return out;
    }`,
  );
  return result.ok ? (result.value ?? []) : [];
}
