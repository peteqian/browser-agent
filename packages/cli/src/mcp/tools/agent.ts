import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  createDecide,
  redactReport,
  runTask,
  RunReportCollector,
  type AgentEvent,
} from "@peteqian/browser-agent-sdk";
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
        cdpUrl: z.string().min(1).optional(),
        autoConsent: z.boolean().optional().default(true),
        fingerprintMode: z.enum(["stealth", "native"]).optional().default("stealth"),
        profile: z.string().min(1).optional(),
        userDataDir: z.string().min(1).optional(),
        storageStatePath: z.string().min(1).optional(),
        provider: z.enum(["codex", "claude", "openai", "anthropic"]).optional().default("codex"),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
        proxy: z.string().min(1).optional(),
        proxyBypass: z.string().min(1).optional(),
        rateLimitMs: z.number().int().positive().optional(),
        rateLimitHostMs: z.number().int().positive().optional(),
        includeReport: z
          .boolean()
          .optional()
          .default(false)
          .describe("Return a structured RunReport (steps, tokens, cost) alongside the result."),
        redact: z
          .boolean()
          .optional()
          .default(false)
          .describe("Scrub emails/phones/task text from the returned report."),
      },
    },
    async (
      {
        task,
        startUrl,
        model,
        effort,
        headless,
        cdpUrl,
        autoConsent,
        fingerprintMode,
        profile,
        userDataDir,
        storageStatePath,
        provider,
        apiKey,
        baseUrl,
        proxy,
        proxyBypass,
        rateLimitMs,
        rateLimitHostMs,
        includeReport,
        redact,
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
      const progressForwarder =
        progressToken !== undefined ? buildProgressForwarder(extra, progressToken) : undefined;
      const reportCollector = includeReport ? new RunReportCollector({ task }) : undefined;
      const handlers = [progressForwarder, reportCollector?.onEvent].filter(
        (h): h is (event: AgentEvent) => void => Boolean(h),
      );
      const onEvent =
        handlers.length === 0
          ? undefined
          : (event: AgentEvent) => {
              for (const h of handlers) h(event);
            };
      const result = await runTask({
        task,
        startUrl,
        cdpUrl,
        ...(rateLimitMs || rateLimitHostMs
          ? {
              rateLimit: {
                ...(rateLimitMs ? { perActionMs: rateLimitMs } : {}),
                ...(rateLimitHostMs ? { perHostMs: rateLimitHostMs } : {}),
              },
            }
          : {}),
        launch: {
          headless,
          autoConsent,
          fingerprintMode,
          userDataDir: paths.userDataDir,
          storageStatePath: paths.storageStatePath,
          ...(proxy ? { proxyServer: proxy } : {}),
          ...(proxyBypass ? { proxyBypass } : {}),
        },
        getNextAction: decide,
        transportResolution: resolution,
        signal: extra.signal,
        onEvent,
      });
      if (reportCollector) {
        const report = reportCollector.build();
        return jsonResult({
          result,
          report: redact ? redactReport(report, { values: task ? [task] : [] }) : report,
        });
      }
      return jsonResult(result);
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
