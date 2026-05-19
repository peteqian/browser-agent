import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { executeAction } from "@peteqian/browser-agent-sdk/internal";
import { jsonResult } from "../helpers";
import { getSession } from "../sessions";

export function registerDialogTools(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;
  registerTool(
    "dialog_handle",
    {
      description: "Accept or dismiss the next/current JavaScript dialog (alert/confirm/prompt/beforeunload).",
      inputSchema: {
        sessionId: z.string(),
        accept: z.boolean(),
        promptText: z.string().optional(),
      },
    },
    async ({ sessionId, accept, promptText }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "dialog_handle", params: { accept, promptText } }),
      );
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
