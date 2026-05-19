import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { executeAction } from "@peteqian/browser-agent-sdk/internal";
import { jsonResult } from "../helpers";
import { getSession } from "../sessions";

export function registerProfilerTools(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;

  registerTool(
    "profiler_start",
    {
      description:
        "Start a CDP performance trace on the active session. Pair with profiler_stop to capture Chrome Trace Event JSON.",
      inputSchema: {
        sessionId: z.string(),
        categories: z.array(z.string()).optional(),
      },
    },
    async ({ sessionId, categories }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "profiler_start", params: { categories } }),
      );
    },
  );

  registerTool(
    "profiler_stop",
    {
      description:
        "Stop the active CDP performance trace and return (or write to file) Chrome Trace Event JSON.",
      inputSchema: {
        sessionId: z.string(),
        fileName: z.string().optional(),
      },
    },
    async ({ sessionId, fileName }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "profiler_stop", params: { fileName } }));
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
