import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { executeAction } from "@peteqian/browser-agent-sdk/internal";
import { jsonResult } from "../helpers";
import { getSession } from "../sessions";

export function registerNetworkTools(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;
  registerTool(
    "network_har_start",
    {
      description: "Begin recording network requests for the current page.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "network_har_start", params: {} }));
    },
  );

  registerTool(
    "network_har_stop",
    {
      description: "Stop recording and return collected HAR-like JSON (or write to file).",
      inputSchema: { sessionId: z.string(), fileName: z.string().optional() },
    },
    async ({ sessionId, fileName }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "network_har_stop", params: { fileName } }),
      );
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
