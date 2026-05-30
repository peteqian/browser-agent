import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { createDecide, runTask } from "@peteqian/browser-agent-sdk";
import { buildProgressForwarder, jsonResult } from "../helpers";
import { resolveBrowserPaths } from "../../profiles";

export function registerAgentTool(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;
  registerTool(
    "run_agent",
    {
      description:
        "Run an autonomous browser agent against a fresh browser session until the task is done. Prefer setting OPENAI_API_KEY/ANTHROPIC_API_KEY in env over passing apiKey here.",
      inputSchema: {
        task: z.string(),
        startUrl: z.string().optional(),
        model: z.string().optional(),
        effort: z.string().optional(),
        headless: z.boolean().optional().default(true),
        autoConsent: z.boolean().optional().default(true),
        profile: z.string().min(1).optional(),
        userDataDir: z.string().min(1).optional(),
        storageStatePath: z.string().min(1).optional(),
        provider: z.enum(["codex", "claude", "openai", "anthropic"]).optional().default("codex"),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
      },
    },
    async (
      {
        task,
        startUrl,
        model,
        effort,
        headless,
        autoConsent,
        profile,
        userDataDir,
        storageStatePath,
        provider,
        apiKey,
        baseUrl,
      },
      extra,
    ) => {
      const { decide, resolution } = createDecide({
        provider,
        model,
        apiKey,
        baseURL: baseUrl,
        effort,
      });
      const progressToken = extra._meta?.progressToken;
      const paths = resolveBrowserPaths({ profile, userDataDir, storageStatePath });
      const onEvent =
        progressToken !== undefined ? buildProgressForwarder(extra, progressToken) : undefined;
      return jsonResult(
        await runTask({
          task,
          startUrl,
          launch: {
            headless,
            autoConsent,
            userDataDir: paths.userDataDir,
            storageStatePath: paths.storageStatePath,
          },
          getNextAction: decide,
          transportResolution: resolution,
          signal: extra.signal,
          onEvent,
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
