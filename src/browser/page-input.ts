import { setTimeout as delay } from "node:timers/promises";

import type { Page } from "./page";
import type { RuntimeExceptionDetails } from "./session-types";

export async function clickByBackendNodeId(
  page: Page,
  backendNodeId: number,
): Promise<{ ok: true } | { ok: false; reason: "index_stale" }> {
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

export async function clickAtCoordinates(page: Page, x: number, y: number): Promise<void> {
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
  type TypeJsResult =
    | "not_typable"
    | { kind: "ok" }
    | { kind: "value_mismatch"; expected: string; actual: string };
  const result = await page.callOnBackendNode<TypeJsResult>(
    backendNodeId,
    `function(text, submit, mode) {
      const tag = this.tagName;
      const isInputLike = tag === "INPUT" || tag === "TEXTAREA";
      if (!isInputLike && !this.isContentEditable) return "not_typable";
      this.focus();
      const setValue = (v) => {
        if (this.isContentEditable) { this.textContent = v; return; }
        const proto = tag === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        const setter = desc && desc.set;
        if (setter) setter.call(this, v); else this.value = v;
      };
      if (mode === "replace") {
        try { if (typeof this.select === "function") this.select(); } catch (_) {}
        setValue("");
        this.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
      }
      const prefix = mode === "append"
        ? (this.isContentEditable ? (this.textContent || "") : (this.value || ""))
        : "";
      const expected = prefix + text;
      setValue(expected);
      this.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
      this.dispatchEvent(new Event("change", { bubbles: true }));
      if (submit) {
        const form = this.form;
        if (form) {
          if (form.requestSubmit) form.requestSubmit(); else form.submit();
        } else {
          this.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          this.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", bubbles: true }));
        }
      }
      const actual = this.isContentEditable ? (this.textContent || "") : (this.value || "");
      if (actual !== expected) return { kind: "value_mismatch", expected: expected, actual: actual };
      return { kind: "ok" };
    }`,
    [text, submit, mode],
  );
  if (!result.ok) {
    if (result.reason === "index_stale") return { ok: false, reason: "index_stale" };
    return { ok: false, reason: "not_typable" };
  }
  if (result.value === "not_typable") return { ok: false, reason: "not_typable" };
  if (typeof result.value === "object" && result.value.kind === "value_mismatch") {
    // Discard expected/actual at this boundary — they may contain a secret.
    return { ok: false, reason: "value_mismatch" };
  }
  return { ok: true };
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
