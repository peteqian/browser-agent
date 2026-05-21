import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { getDashboardStatus, readDashboardManifest } from "../../dashboard/server";
import { indexFromRef, jsonResult } from "../helpers";

const elementRef = z.string().regex(/^@?e\d+$/, "Use @eN from the latest observation.");

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
    "daemon_search_page",
    {
      description: "Search page text in a dashboard-daemon session.",
      inputSchema: {
        sessionId: z.string(),
        pattern: z.string().min(1),
        regex: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        contextChars: z.number().int().positive().max(1000).optional(),
        cssScope: z.string().optional(),
        maxResults: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ sessionId, pattern, regex, caseSensitive, contextChars, cssScope, maxResults }) =>
      jsonResult(
        await daemonAction(sessionId, "search_page", {
          pattern,
          regex,
          caseSensitive,
          contextChars,
          cssScope,
          maxResults,
        }),
      ),
  );

  registerTool(
    "daemon_find_elements",
    {
      description: "Find elements by CSS selector in a dashboard-daemon session.",
      inputSchema: {
        sessionId: z.string(),
        selector: z.string().min(1),
        attributes: z.array(z.string().min(1)).optional(),
        maxResults: z.number().int().positive().max(200).optional(),
        includeText: z.boolean().optional(),
      },
    },
    async ({ sessionId, selector, attributes, maxResults, includeText }) =>
      jsonResult(
        await daemonAction(sessionId, "find_elements", {
          selector,
          attributes,
          maxResults,
          includeText,
        }),
      ),
  );

  registerTool(
    "daemon_get_dropdown_options",
    {
      description: "Get dropdown options from a select element in a dashboard-daemon session.",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        ref: elementRef.optional(),
      },
    },
    async ({ sessionId, index, ref }) => {
      const resolved = indexFromRef({ index, ref });
      if (typeof resolved !== "number") throw new Error("Provide index or ref, e.g. @e4.");
      return jsonResult(await daemonAction(sessionId, "get_dropdown_options", { index: resolved }));
    },
  );

  registerTool(
    "daemon_find_text",
    {
      description: "Scroll to the first visible occurrence of text in a dashboard-daemon session.",
      inputSchema: { sessionId: z.string(), text: z.string().min(1) },
    },
    async ({ sessionId, text }) => jsonResult(await daemonAction(sessionId, "find_text", { text })),
  );

  registerTool(
    "daemon_screenshot",
    {
      description: "Capture a screenshot for a dashboard-daemon session.",
      inputSchema: {
        sessionId: z.string(),
        fileName: z.string().optional(),
        annotate: z.boolean().optional(),
      },
    },
    async ({ sessionId, fileName, annotate }) =>
      jsonResult(await daemonAction(sessionId, "screenshot", { fileName, annotate })),
  );

  registerTool(
    "daemon_save_as_pdf",
    {
      description: "Save the current dashboard-daemon session page as a PDF file.",
      inputSchema: {
        sessionId: z.string(),
        fileName: z.string().optional(),
        printBackground: z.boolean().optional(),
        landscape: z.boolean().optional(),
        scale: z.number().min(0.1).max(2).optional(),
        paperFormat: z.enum(["Letter", "Legal", "A4", "A3", "Tabloid"]).optional(),
      },
    },
    async ({ sessionId, fileName, printBackground, landscape, scale, paperFormat }) =>
      jsonResult(
        await daemonAction(sessionId, "save_as_pdf", {
          fileName,
          printBackground,
          landscape,
          scale,
          paperFormat,
        }),
      ),
  );

  registerTool(
    "daemon_extract_content",
    {
      description: "Extract page content from a dashboard-daemon session.",
      inputSchema: {
        sessionId: z.string(),
        query: z.string().min(1),
        extractLinks: z.boolean().optional(),
        extractImages: z.boolean().optional(),
        startFromChar: z.number().int().nonnegative().optional(),
        maxChars: z.number().int().positive().max(200_000).optional(),
      },
    },
    async ({ sessionId, query, extractLinks, extractImages, startFromChar, maxChars }) =>
      jsonResult(
        await daemonAction(sessionId, "extract_content", {
          query,
          extractLinks,
          extractImages,
          startFromChar,
          maxChars,
        }),
      ),
  );

  registerTool(
    "daemon_list_artifacts",
    {
      description: "List saved screenshots and PDFs for a dashboard-daemon session.",
      inputSchema: {
        sessionId: z.string(),
        kind: z.enum(["screenshot", "pdf"]).optional(),
      },
    },
    async ({ sessionId, kind }) =>
      jsonResult(
        await daemonRequest(`/api/sessions/${sessionId}/artifacts${kind ? `?kind=${kind}` : ""}`),
      ),
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

async function daemonAction(sessionId: string, name: string, params: Record<string, unknown>) {
  return daemonRequest(`/api/sessions/${sessionId}/action`, "POST", { name, params });
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
