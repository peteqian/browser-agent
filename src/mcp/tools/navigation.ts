import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { executeAction } from "../../actions/execute";
import { jsonResult } from "../helpers";
import { getSession, setCurrentPage } from "../sessions";

export function registerNavigationTools(server: McpServer): void {
  server.registerTool(
    "navigate",
    {
      description: "Navigate to a URL.",
      inputSchema: z.object({
        sessionId: z.string(),
        url: z.string().url(),
        newTab: z.boolean().optional(),
      }),
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

  server.registerTool(
    "go_back",
    {
      description: "Navigate back in browser history.",
      inputSchema: z.object({ sessionId: z.string() }),
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "go_back", params: {} }));
    },
  );

  server.registerTool(
    "go_forward",
    {
      description: "Navigate forward in browser history.",
      inputSchema: z.object({ sessionId: z.string() }),
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "go_forward", params: {} }));
    },
  );

  server.registerTool(
    "refresh",
    {
      description: "Refresh current page.",
      inputSchema: z.object({ sessionId: z.string() }),
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "refresh", params: {} }));
    },
  );
}
