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

  registerTool(
    "network_list_requests",
    {
      description:
        "Return filtered requests captured by the active HAR recorder. Requires network_har_start to have been called first.",
      inputSchema: {
        sessionId: z.string(),
        urlIncludes: z.string().min(1).max(500).optional(),
        method: z.string().min(1).max(20).optional(),
        status: z
          .union([z.number().int().min(100).max(599), z.enum(["1xx", "2xx", "3xx", "4xx", "5xx"])])
          .optional(),
        maxResults: z.number().int().positive().max(500).optional(),
      },
    },
    async ({ sessionId, urlIncludes, method, status, maxResults }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "network_list_requests",
          params: { urlIncludes, method, status, maxResults },
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
