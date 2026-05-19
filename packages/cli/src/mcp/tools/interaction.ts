import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { executeAction } from "@peteqian/browser-agent-sdk/internal";
import { jsonResult } from "../helpers";
import { getSession } from "../sessions";

export function registerInteractionTools(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;
  registerTool(
    "send_keys",
    {
      description: "Send keyboard key(s) to active element.",
      inputSchema: { sessionId: z.string(), keys: z.string().min(1) },
    },
    async ({ sessionId, keys }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "send_keys", params: { keys } }));
    },
  );

  registerTool(
    "select_option",
    {
      description: "Select option on dropdown element [index] by label or value.",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative(),
        value: z.string().min(1),
      },
    },
    async ({ sessionId, index, value }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "select_option", params: { index, value } }),
      );
    },
  );

  registerTool(
    "upload_file",
    {
      description: "Upload local file path(s) to input element [index].",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative(),
        paths: z.array(z.string().min(1)).min(1),
      },
    },
    async ({ sessionId, index, paths }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "upload_file", params: { index, paths } }),
      );
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
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "wait_for_text", params: { text, timeoutMs } }),
      );
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
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "wait", params: { ms } }));
    },
  );

  registerTool(
    "click",
    {
      description: "Click element by [index] or by viewport coordinates.",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        coordinateX: z.number().int().optional(),
        coordinateY: z.number().int().optional(),
      },
    },
    async ({ sessionId, index, coordinateX, coordinateY }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "click",
          params: { index, coordinateX, coordinateY },
        }),
      );
    },
  );

  registerTool(
    "type",
    {
      description:
        "Type text into element [index]. Set submit=true to press Enter. mode='replace' (default) clears the field first; mode='append' keeps the existing value.",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative(),
        text: z.string(),
        submit: z.boolean().optional(),
        mode: z.enum(["replace", "append"]).optional(),
      },
    },
    async ({ sessionId, index, text, submit, mode }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "type",
          params: { index, text, submit, mode: mode ?? "replace" },
        }),
      );
    },
  );

  registerTool(
    "hover",
    {
      description: "Hover the mouse over element [index].",
      inputSchema: { sessionId: z.string(), index: z.number().int().nonnegative() },
    },
    async ({ sessionId, index }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "hover", params: { index } }));
    },
  );

  registerTool(
    "dblclick",
    {
      description: "Double-click element [index].",
      inputSchema: { sessionId: z.string(), index: z.number().int().nonnegative() },
    },
    async ({ sessionId, index }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "dblclick", params: { index } }));
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
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "find_by_role", params: { role, name } }),
      );
    },
  );

  registerTool(
    "find_by_text",
    {
      description: "Return indices of snapshot elements whose visible/accessible text contains the substring.",
      inputSchema: { sessionId: z.string(), text: z.string().min(1) },
    },
    async ({ sessionId, text }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "find_by_text", params: { text } }));
    },
  );

  registerTool(
    "find_by_testid",
    {
      description: "Return indices of snapshot elements with a matching data-testid.",
      inputSchema: { sessionId: z.string(), testid: z.string().min(1) },
    },
    async ({ sessionId, testid }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "find_by_testid", params: { testid } }),
      );
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
      },
    },
    async ({ sessionId, direction, amount, pages, index }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "scroll",
          params: { direction, amount, pages, index },
        }),
      );
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
