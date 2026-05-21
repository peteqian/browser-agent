import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { Action } from "@peteqian/browser-agent-sdk/internal";
import { indexFromRef, runSessionAction, runSessionActions } from "../helpers";
import { getSession } from "../sessions";

const elementRef = z.string().regex(/^@?e\d+$/, "Use @eN from the latest observation.");
const maybeElementRef = {
  index: z.number().int().nonnegative().optional(),
  ref: elementRef.optional(),
};
const batchActionSchema = z.discriminatedUnion("name", [
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

function readIndex(input: { index?: number; ref?: string }): number {
  const index = indexFromRef(input);
  if (typeof index === "number") return index;
  throw new Error("Provide index or ref, e.g. @e4.");
}

function toBatchAction(input: z.infer<typeof batchActionSchema>): Action {
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

export function registerInteractionTools(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;
  registerTool(
    "run_actions",
    {
      description:
        "Run 1-10 simple page actions in order and return one final observation. Use only when no intermediate observation is needed.",
      inputSchema: {
        sessionId: z.string(),
        actions: z.array(batchActionSchema).min(1).max(10),
      },
    },
    async ({ sessionId, actions }) => {
      const record = getSession(sessionId);
      return runSessionActions(record, actions.map(toBatchAction));
    },
  );

  registerTool(
    "send_keys",
    {
      description: "Send keyboard key(s) to active element.",
      inputSchema: { sessionId: z.string(), keys: z.string().min(1) },
    },
    async ({ sessionId, keys }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "send_keys", params: { keys } });
    },
  );

  registerTool(
    "press",
    {
      description: "Press a keyboard key or chord on the active element, e.g. Enter or Meta+A.",
      inputSchema: { sessionId: z.string(), key: z.string().min(1) },
    },
    async ({ sessionId, key }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "press", params: { key } });
    },
  );

  registerTool(
    "keyboard_type",
    {
      description: "Type text into the currently focused element using browser keyboard input.",
      inputSchema: { sessionId: z.string(), text: z.string().min(1) },
    },
    async ({ sessionId, text }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "keyboard_type", params: { text } });
    },
  );

  registerTool(
    "select_option",
    {
      description: "Select option on dropdown element [index] by label or value.",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        ref: elementRef.optional(),
        value: z.string().min(1),
      },
    },
    async ({ sessionId, index, ref, value }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "select_option",
        params: { index: readIndex({ index, ref }), value },
      });
    },
  );

  registerTool(
    "upload_file",
    {
      description: "Upload local file path(s) to input element [index].",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        ref: elementRef.optional(),
        paths: z.array(z.string().min(1)).min(1),
      },
    },
    async ({ sessionId, index, ref, paths }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "upload_file",
        params: { index: readIndex({ index, ref }), paths },
      });
    },
  );

  registerTool(
    "wait_for_text",
    {
      description: "Wait for text to appear on current page.",
      inputSchema: {
        sessionId: z.string(),
        text: z.string().min(1),
        timeoutMs: z.number().int().positive().max(30_000).optional(),
      },
    },
    async ({ sessionId, text, timeoutMs }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "wait_for_text", params: { text, timeoutMs } });
    },
  );

  registerTool(
    "wait",
    {
      description: "Sleep for the given number of milliseconds (max 10000).",
      inputSchema: {
        sessionId: z.string(),
        ms: z.number().int().positive().max(10_000),
      },
    },
    async ({ sessionId, ms }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "wait", params: { ms } });
    },
  );

  registerTool(
    "click",
    {
      description: "Click element by [index] or by viewport coordinates.",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        ref: elementRef.optional(),
        coordinateX: z.number().int().optional(),
        coordinateY: z.number().int().optional(),
      },
    },
    async ({ sessionId, index, ref, coordinateX, coordinateY }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "click",
        params: { index: indexFromRef({ index, ref }), coordinateX, coordinateY },
      });
    },
  );

  registerTool(
    "focus",
    {
      description: "Focus element [index] or ref @eN.",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        ref: elementRef.optional(),
      },
    },
    async ({ sessionId, index, ref }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "focus",
        params: { index: readIndex({ index, ref }) },
      });
    },
  );

  registerTool(
    "type",
    {
      description:
        "Type text into element [index]. Set submit=true to press Enter. mode='replace' (default) clears the field first; mode='append' keeps the existing value.",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        ref: elementRef.optional(),
        text: z.string(),
        submit: z.boolean().optional(),
        mode: z.enum(["replace", "append"]).optional(),
      },
    },
    async ({ sessionId, index, ref, text, submit, mode }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "type",
        params: { index: readIndex({ index, ref }), text, submit, mode: mode ?? "replace" },
      });
    },
  );

  registerTool(
    "fill",
    {
      description:
        "Focus and replace text in element [index] or ref @eN using browser-native input events.",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        ref: elementRef.optional(),
        text: z.string(),
        submit: z.boolean().optional(),
      },
    },
    async ({ sessionId, index, ref, text, submit }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "fill",
        params: { index: readIndex({ index, ref }), text, submit },
      });
    },
  );

  registerTool(
    "hover",
    {
      description: "Hover the mouse over element [index].",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        ref: elementRef.optional(),
      },
    },
    async ({ sessionId, index, ref }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "hover",
        params: { index: readIndex({ index, ref }) },
      });
    },
  );

  registerTool(
    "dblclick",
    {
      description: "Double-click element [index].",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        ref: elementRef.optional(),
      },
    },
    async ({ sessionId, index, ref }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "dblclick",
        params: { index: readIndex({ index, ref }) },
      });
    },
  );

  registerTool(
    "find_by_role",
    {
      description: "Return indices of snapshot elements matching ARIA role (and optional name).",
      inputSchema: {
        sessionId: z.string(),
        role: z.string().min(1),
        name: z.string().optional(),
      },
    },
    async ({ sessionId, role, name }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "find_by_role", params: { role, name } });
    },
  );

  registerTool(
    "find_by_text",
    {
      description:
        "Return indices of snapshot elements whose visible/accessible text contains the substring.",
      inputSchema: { sessionId: z.string(), text: z.string().min(1) },
    },
    async ({ sessionId, text }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "find_by_text", params: { text } });
    },
  );

  registerTool(
    "find_by_testid",
    {
      description: "Return indices of snapshot elements with a matching data-testid.",
      inputSchema: { sessionId: z.string(), testid: z.string().min(1) },
    },
    async ({ sessionId, testid }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "find_by_testid", params: { testid } });
    },
  );

  registerTool(
    "scroll",
    {
      description: "Scroll the page.",
      inputSchema: {
        sessionId: z.string(),
        direction: z.enum(["up", "down", "top", "bottom"]),
        amount: z.number().int().positive().optional(),
        pages: z.number().positive().max(10).optional(),
        index: z.number().int().nonnegative().optional(),
        ref: elementRef.optional(),
      },
    },
    async ({ sessionId, direction, amount, pages, index, ref }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "scroll",
        params: { direction, amount, pages, index: indexFromRef({ index, ref }) },
      });
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
