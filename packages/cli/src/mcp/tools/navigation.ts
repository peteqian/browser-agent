import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { runSessionAction } from "../helpers";
import { getSession } from "../sessions";

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
      return runSessionAction(record, { name: "navigate", params: { url, newTab } });
    },
  );

  registerTool(
    "go_back",
    {
      description: "Navigate back in browser history.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "go_back", params: {} });
    },
  );

  registerTool(
    "go_forward",
    {
      description: "Navigate forward in browser history.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "go_forward", params: {} });
    },
  );

  registerTool(
    "refresh",
    {
      description: "Refresh current page.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "refresh", params: {} });
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
