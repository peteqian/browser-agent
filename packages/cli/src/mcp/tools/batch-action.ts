import { z } from "zod";

import type { Action } from "@peteqian/browser-agent-sdk/internal";
import { indexFromRef } from "../helpers";

export const elementRef = z.string().regex(/^@?e\d+$/, "Use @eN from the latest observation.");

const maybeElementRef = {
  index: z.number().int().nonnegative().optional(),
  ref: elementRef.optional(),
};

export const batchActionSchema = z.discriminatedUnion("name", [
  z.object({
    name: z.literal("click"),
    ...maybeElementRef,
    coordinateX: z.number().int().optional(),
    coordinateY: z.number().int().optional(),
  }),
  z.object({ name: z.literal("focus"), ...maybeElementRef }),
  z.object({
    name: z.literal("type"),
    ...maybeElementRef,
    text: z.string(),
    submit: z.boolean().optional(),
    mode: z.enum(["replace", "append"]).optional(),
  }),
  z.object({
    name: z.literal("fill"),
    ...maybeElementRef,
    text: z.string(),
    submit: z.boolean().optional(),
  }),
  z.object({ name: z.literal("press"), key: z.string().min(1) }),
  z.object({ name: z.literal("keyboard_type"), text: z.string().min(1) }),
  z.object({ name: z.literal("send_keys"), keys: z.string().min(1) }),
  z.object({ name: z.literal("wait"), ms: z.number().int().positive().max(10_000) }),
  z.object({
    name: z.literal("scroll"),
    direction: z.enum(["up", "down", "top", "bottom"]),
    amount: z.number().int().positive().optional(),
    pages: z.number().positive().max(10).optional(),
    ...maybeElementRef,
  }),
  z.object({ name: z.literal("hover"), ...maybeElementRef }),
  z.object({ name: z.literal("dblclick"), ...maybeElementRef }),
  z.object({
    name: z.literal("select_option"),
    ...maybeElementRef,
    value: z.string().min(1),
  }),
]);

export function readIndex(input: { index?: number; ref?: string }): number {
  const index = indexFromRef(input);
  if (typeof index === "number") return index;
  throw new Error("Provide index or ref, e.g. @e4.");
}

export function toBatchAction(input: z.infer<typeof batchActionSchema>): Action {
  switch (input.name) {
    case "click":
      return {
        name: "click",
        params: {
          index: indexFromRef(input),
          coordinateX: input.coordinateX,
          coordinateY: input.coordinateY,
        },
      };
    case "focus":
      return { name: "focus", params: { index: readIndex(input) } };
    case "type":
      return {
        name: "type",
        params: {
          index: readIndex(input),
          text: input.text,
          submit: input.submit,
          mode: input.mode ?? "replace",
        },
      };
    case "fill":
      return {
        name: "fill",
        params: { index: readIndex(input), text: input.text, submit: input.submit },
      };
    case "press":
      return { name: "press", params: { key: input.key } };
    case "keyboard_type":
      return { name: "keyboard_type", params: { text: input.text } };
    case "send_keys":
      return { name: "send_keys", params: { keys: input.keys } };
    case "wait":
      return { name: "wait", params: { ms: input.ms } };
    case "scroll":
      return {
        name: "scroll",
        params: {
          direction: input.direction,
          amount: input.amount,
          pages: input.pages,
          index: indexFromRef(input),
        },
      };
    case "hover":
      return { name: "hover", params: { index: readIndex(input) } };
    case "dblclick":
      return { name: "dblclick", params: { index: readIndex(input) } };
    case "select_option":
      return {
        name: "select_option",
        params: { index: readIndex(input), value: input.value },
      };
  }
}
