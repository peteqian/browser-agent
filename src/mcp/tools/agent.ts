import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { runAgent } from "../../agent/loop";
import { createDecide } from "../../llm";
import { buildProgressForwarder, jsonResult } from "../helpers";

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
        maxSteps: z.number().int().min(1).max(200).optional(),
        model: z.string().optional(),
        effort: z.string().optional(),
        headless: z.boolean().optional().default(true),
        provider: z.enum(["codex", "claude", "openai", "anthropic"]).optional().default("codex"),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
      },
    },
    async (
      { task, startUrl, maxSteps, model, effort, headless, provider, apiKey, baseUrl },
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
      const onEvent =
        progressToken !== undefined
          ? buildProgressForwarder(extra, progressToken, maxSteps ?? 40)
          : undefined;
      return jsonResult(
        await runAgent({
          task,
          startUrl,
          maxSteps,
          launch: { headless },
          decide,
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
