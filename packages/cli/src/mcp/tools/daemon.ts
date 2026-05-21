import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getDashboardStatus, readDashboardManifest } from "../../dashboard/server";
import { jsonResult } from "../helpers";

export function registerDaemonTools(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;

  registerTool(
    "daemon_status",
    {
      description: "Find the running browser-agent dashboard daemon and return its health.",
      inputSchema: {},
    },
    async () => jsonResult(await daemonStatus()),
  );

  registerTool(
    "daemon_list_sessions",
    {
      description: "List sessions owned by the running dashboard daemon.",
      inputSchema: {},
    },
    async () => jsonResult(await daemonRequest("/api/sessions")),
  );

  registerTool(
    "daemon_attach_session",
    {
      description:
        "Attach to a session owned by the running dashboard daemon by sessionId or profile.",
      inputSchema: {
        sessionId: z.string().optional(),
        profile: z.string().min(1).optional(),
      },
    },
    async (input) => jsonResult(await daemonRequest("/api/sessions/attach", "POST", input)),
  );

  registerTool(
    "daemon_launch_session",
    {
      description:
        "Launch a new session in the running dashboard daemon and return its first observation.",
      inputSchema: {
        profile: z.string().min(1).optional(),
        startUrl: z.string().optional(),
        headless: z.boolean().optional(),
        autoConsent: z.boolean().optional(),
        userDataDir: z.string().min(1).optional(),
        storageStatePath: z.string().min(1).optional(),
        saveStorageStateOnClose: z.boolean().optional(),
        executablePath: z.string().min(1).optional(),
        channel: z
          .enum([
            "chromium",
            "chrome",
            "chrome-beta",
            "chrome-dev",
            "chrome-canary",
            "msedge",
            "msedge-beta",
            "msedge-dev",
            "msedge-canary",
            "lightpanda",
          ])
          .optional(),
        locale: z.string().min(1).optional(),
        timezoneId: z.string().min(1).optional(),
        acceptLanguage: z.string().min(1).optional(),
      },
    },
    async (input) => jsonResult(await daemonRequest("/api/sessions", "POST", input)),
  );

  registerTool(
    "daemon_get_snapshot",
    {
      description: "Get the current observation for a dashboard-daemon session.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => jsonResult(await daemonRequest(`/api/sessions/${sessionId}/snapshot`)),
  );

  registerTool(
    "daemon_action",
    {
      description:
        "Run one SDK action against a dashboard-daemon session. Shape: { name, params }.",
      inputSchema: {
        sessionId: z.string(),
        name: z.string().min(1),
        params: z.record(z.unknown()).optional(),
      },
    },
    async ({ sessionId, name, params }) =>
      jsonResult(
        await daemonRequest(`/api/sessions/${sessionId}/action`, "POST", { name, params }),
      ),
  );

  registerTool(
    "daemon_actions",
    {
      description: "Run multiple SDK actions against a dashboard-daemon session.",
      inputSchema: {
        sessionId: z.string(),
        actions: z
          .array(z.object({ name: z.string().min(1), params: z.record(z.unknown()).optional() }))
          .min(1)
          .max(10),
      },
    },
    async ({ sessionId, actions }) =>
      jsonResult(await daemonRequest(`/api/sessions/${sessionId}/actions`, "POST", { actions })),
  );

  registerTool(
    "daemon_session_events",
    {
      description: "List recent events for a dashboard-daemon session.",
      inputSchema: {
        sessionId: z.string(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ sessionId, limit }) =>
      jsonResult(
        await daemonRequest(`/api/sessions/${sessionId}/events${limit ? `?limit=${limit}` : ""}`),
      ),
  );

  registerTool(
    "daemon_close_session",
    {
      description: "Close a session owned by the running dashboard daemon.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) =>
      jsonResult(await daemonRequest(`/api/sessions/${sessionId}`, "DELETE")),
  );
}

async function daemonStatus() {
  return getDashboardStatus({ cleanStale: true });
}

async function daemonRequest(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: unknown,
  explicitBaseUrl?: string,
) {
  const baseUrl = explicitBaseUrl ?? readDashboardManifest()?.url;
  if (!baseUrl) throw new Error("No running dashboard daemon manifest found.");
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  });
  const value = await response.json();
  const error =
    value && typeof value === "object" ? (value as { error?: unknown }).error : undefined;
  if (!response.ok) {
    throw new Error(
      typeof error === "string" ? error : `Daemon request failed: ${response.status}`,
    );
  }
  return value;
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
