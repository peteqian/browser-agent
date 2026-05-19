import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { executeAction } from "@peteqian/browser-agent-sdk/internal";
import { jsonResult } from "../helpers";
import { getSession, setCurrentPage } from "../sessions";

export function registerNavigationTools(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;
  registerTool(
    "navigate",
    {
      description: "Navigate to a URL.",
      inputSchema: {
        sessionId: z.string(),
        url: z.string().url(),
        newTab: z.boolean().optional(),
      },
    },
    async ({ sessionId, url, newTab }) => {
      const record = getSession(sessionId);
      const result = await executeAction(
        record.page,
        { name: "navigate", params: { url, newTab } },
        record.session,
      );
      if (result.activeTargetId) setCurrentPage(record, result.activeTargetId);
      return jsonResult(result);
    },
  );

  registerTool(
    "go_back",
    {
      description: "Navigate back in browser history.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "go_back", params: {} }));
    },
  );

  registerTool(
    "go_forward",
    {
      description: "Navigate forward in browser history.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "go_forward", params: {} }));
    },
  );

  registerTool(
    "switch_frame",
    {
      description: "Switch active frame context. Pass frameId or index, or omit both to return to main frame.",
      inputSchema: {
        sessionId: z.string(),
        frameId: z.string().optional(),
        index: z.number().int().nonnegative().optional(),
      },
    },
    async ({ sessionId, frameId, index }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "switch_frame", params: { frameId, index } }),
      );
    },
  );

  registerTool(
    "refresh",
    {
      description: "Refresh current page.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "refresh", params: {} }));
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
