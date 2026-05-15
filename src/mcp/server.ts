import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { executeAction } from "../actions/execute";
import { BrowserSession, type Page } from "../browser/session";
import { formatSnapshotForLLM, serializePage } from "../dom/serialize";
import { runAgent } from "../agent/loop";
import type { AgentEvent, OnEventCallback } from "../agent/contracts";
import { createDecide } from "../llm";
import { PACKAGE_NAME, VERSION } from "../version";

interface SessionRecord {
  session: BrowserSession;
  page: Page;
  lastAccessedAt: number;
}

const sessions = new Map<string, SessionRecord>();
let sessionCounter = 0;

const MCP_SESSION_TTL_MS = Number(process.env.MCP_SESSION_TTL_MS ?? 30 * 60 * 1000);
const MCP_SESSION_SWEEP_MS = Number(process.env.MCP_SESSION_SWEEP_MS ?? 10 * 60 * 1000);
let sweepTimer: ReturnType<typeof setInterval> | undefined;

function nextSessionId(): string {
  sessionCounter += 1;
  return `sess_${Date.now().toString(36)}_${sessionCounter}`;
}

function getSession(sessionId: string): SessionRecord {
  const record = sessions.get(sessionId);
  if (!record) {
    throw new Error(`Unknown sessionId: ${sessionId}`);
  }
  record.lastAccessedAt = Date.now();
  return record;
}

async function disposeSession(sessionId: string): Promise<void> {
  const record = sessions.get(sessionId);
  if (!record) return;
  sessions.delete(sessionId);
  await record.session.close().catch(() => {});
}

export async function sweepIdleSessions(now: number = Date.now()): Promise<string[]> {
  const expired: string[] = [];
  for (const [id, record] of sessions) {
    if (now - record.lastAccessedAt > MCP_SESSION_TTL_MS) {
      expired.push(id);
    }
  }
  await Promise.all(expired.map((id) => disposeSession(id)));
  return expired;
}

function ensureSweeper(): void {
  if (sweepTimer) return;
  if (MCP_SESSION_SWEEP_MS <= 0 || MCP_SESSION_TTL_MS <= 0) return;
  sweepTimer = setInterval(() => {
    void sweepIdleSessions();
  }, MCP_SESSION_SWEEP_MS);
  if (typeof sweepTimer.unref === "function") sweepTimer.unref();
}

export async function shutdownAllSessions(): Promise<void> {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = undefined;
  }
  const ids = Array.from(sessions.keys());
  await Promise.all(ids.map((id) => disposeSession(id)));
}

function setCurrentPage(record: SessionRecord, targetId: string): void {
  record.page = record.session.getPage(targetId);
}

function textResult(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function jsonResult(value: unknown) {
  return textResult(typeof value === "string" ? value : JSON.stringify(value));
}

interface ProgressCapableExtra {
  sendNotification: (notification: {
    method: "notifications/progress";
    params: {
      progressToken: string | number;
      progress: number;
      total?: number;
      message?: string;
    };
  }) => Promise<void>;
}

/**
 * Map AgentEvents to MCP progress notifications. Progress must be monotonic,
 * so we use the running step index — bumped 0.5 between decision and action
 * within the same step so clients see two updates per step.
 *
 * Errors from sendNotification are swallowed: progress is best-effort and
 * must not break the run.
 */
function buildProgressForwarder(
  extra: ProgressCapableExtra,
  progressToken: string | number,
  total: number,
): OnEventCallback {
  let progress = 0;

  return async (event: AgentEvent) => {
    let message: string | undefined;
    if (event.type === "transport_resolved") {
      message = `transport=${event.resolution.transport} (${event.resolution.provider}/${event.resolution.env})`;
    } else if (event.type === "decision") {
      progress = Math.max(progress + 0.5, event.step);
      const action = event.decision.actions[0];
      message = action ? `step ${event.step}: decided ${action.name}` : `step ${event.step}`;
    } else if (event.type === "action") {
      progress += 0.5;
      message = `${event.action.name}: ${event.result.ok ? "ok" : "failed"}`;
    } else if (event.type === "terminal") {
      progress = total;
      message = event.result.success
        ? `done: ${event.result.summary ?? ""}`
        : `failed: ${event.result.reason}`;
    }

    try {
      await extra.sendNotification({
        method: "notifications/progress",
        params: {
          progressToken,
          progress,
          total,
          ...(message ? { message } : {}),
        },
      });
    } catch {
      // Best-effort. A broken progress channel must not abort the agent run.
    }
  };
}

export function createServer(): McpServer {
  const server = new McpServer({ name: PACKAGE_NAME, version: VERSION });

  server.registerTool(
    "launch_session",
    {
      description: "Launch a Chromium session. Returns sessionId for subsequent tool calls.",
      inputSchema: z.object({
        headless: z.boolean().optional().default(true),
        startUrl: z.string().optional(),
      }),
    },
    async ({ headless, startUrl }) => {
      const session = await BrowserSession.launch({
        headless,
      });
      const page = await session.newPage();
      const sessionId = nextSessionId();
      sessions.set(sessionId, { session, page, lastAccessedAt: Date.now() });
      ensureSweeper();
      if (startUrl) {
        await page.goto(startUrl);
      }
      return jsonResult({ sessionId });
    },
  );

  server.registerTool(
    "new_tab",
    {
      description: "Open a new tab and optionally navigate to URL. Makes the new tab active.",
      inputSchema: z.object({ sessionId: z.string(), url: z.string().url().optional() }),
    },
    async ({ sessionId, url }) => {
      const record = getSession(sessionId);
      const page = await record.session.newPage();
      if (url) {
        await page.goto(url);
      }
      record.page = page;
      return jsonResult({ targetId: page.targetId, active: true });
    },
  );

  server.registerTool(
    "list_tabs",
    {
      description: "List open tab target IDs and active target ID.",
      inputSchema: z.object({ sessionId: z.string() }),
    },
    async ({ sessionId }) => {
      const record = getSession(sessionId);
      const targetIds = await record.session.listPageTargetIds();
      return jsonResult({ targetIds, activeTargetId: record.page.targetId });
    },
  );

  server.registerTool(
    "switch_tab",
    {
      description: "Switch active tab by targetId or pageId.",
      inputSchema: z.object({
        sessionId: z.string(),
        targetId: z.string().min(1).optional(),
        pageId: z.number().int().nonnegative().optional(),
      }),
    },
    async ({ sessionId, targetId, pageId }) => {
      const record = getSession(sessionId);
      const result = await executeAction(
        record.page,
        {
          name: "switch_tab",
          params: { targetId, pageId },
        },
        record.session,
      );
      if (result.activeTargetId) {
        setCurrentPage(record, result.activeTargetId);
      }
      return jsonResult(result);
    },
  );

  server.registerTool(
    "close_tab",
    {
      description: "Close tab by targetId, pageId, or active tab when omitted.",
      inputSchema: z.object({
        sessionId: z.string(),
        targetId: z.string().optional(),
        pageId: z.number().int().nonnegative().optional(),
      }),
    },
    async ({ sessionId, targetId, pageId }) => {
      const record = getSession(sessionId);
      const result = await executeAction(
        record.page,
        {
          name: "close_tab",
          params: { targetId, pageId },
        },
        record.session,
      );
      if (result.activeTargetId) {
        setCurrentPage(record, result.activeTargetId);
      }
      return jsonResult(result);
    },
  );

  server.registerTool(
    "close_session",
    {
      description: "Close a Chromium session and release resources.",
      inputSchema: z.object({ sessionId: z.string() }),
    },
    async ({ sessionId }) => {
      const record = getSession(sessionId);
      await record.session.close();
      sessions.delete(sessionId);
      return jsonResult({ closed: true });
    },
  );

  server.registerTool(
    "close_browser",
    {
      description: "Close a Chromium browser session and release resources.",
      inputSchema: z.object({ sessionId: z.string() }),
    },
    async ({ sessionId }) => {
      const record = getSession(sessionId);
      const result = await executeAction(
        record.page,
        {
          name: "close_browser",
          params: {},
        },
        record.session,
      );
      sessions.delete(sessionId);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "send_keys",
    {
      description: "Send keyboard key(s) to active element.",
      inputSchema: z.object({ sessionId: z.string(), keys: z.string().min(1) }),
    },
    async ({ sessionId, keys }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "send_keys", params: { keys } }));
    },
  );

  server.registerTool(
    "select_option",
    {
      description: "Select option on dropdown element [index] by label or value.",
      inputSchema: z.object({
        sessionId: z.string(),
        index: z.number().int().nonnegative(),
        value: z.string().min(1),
      }),
    },
    async ({ sessionId, index, value }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "select_option", params: { index, value } }),
      );
    },
  );

  server.registerTool(
    "upload_file",
    {
      description: "Upload local file path(s) to input element [index].",
      inputSchema: z.object({
        sessionId: z.string(),
        index: z.number().int().nonnegative(),
        paths: z.array(z.string().min(1)).min(1),
      }),
    },
    async ({ sessionId, index, paths }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "upload_file", params: { index, paths } }),
      );
    },
  );

  server.registerTool(
    "wait_for_text",
    {
      description: "Wait for text to appear on current page.",
      inputSchema: z.object({
        sessionId: z.string(),
        text: z.string().min(1),
        timeoutMs: z.number().int().positive().max(30_000).optional(),
      }),
    },
    async ({ sessionId, text, timeoutMs }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "wait_for_text", params: { text, timeoutMs } }),
      );
    },
  );

  server.registerTool(
    "wait",
    {
      description: "Sleep for the given number of milliseconds (max 10000).",
      inputSchema: z.object({
        sessionId: z.string(),
        ms: z.number().int().positive().max(10_000),
      }),
    },
    async ({ sessionId, ms }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "wait", params: { ms } }));
    },
  );

  server.registerTool(
    "navigate",
    {
      description: "Navigate to a URL.",
      inputSchema: z.object({
        sessionId: z.string(),
        url: z.string().url(),
        newTab: z.boolean().optional(),
      }),
    },
    async ({ sessionId, url, newTab }) => {
      const record = getSession(sessionId);
      const result = await executeAction(
        record.page,
        { name: "navigate", params: { url, newTab } },
        record.session,
      );
      if (result.activeTargetId) {
        setCurrentPage(record, result.activeTargetId);
      }
      return jsonResult(result);
    },
  );

  server.registerTool(
    "go_back",
    {
      description: "Navigate back in browser history.",
      inputSchema: z.object({ sessionId: z.string() }),
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "go_back", params: {} }));
    },
  );

  server.registerTool(
    "go_forward",
    {
      description: "Navigate forward in browser history.",
      inputSchema: z.object({ sessionId: z.string() }),
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "go_forward", params: {} }));
    },
  );

  server.registerTool(
    "refresh",
    {
      description: "Refresh current page.",
      inputSchema: z.object({ sessionId: z.string() }),
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "refresh", params: {} }));
    },
  );

  server.registerTool(
    "get_snapshot",
    {
      description:
        "Return a formatted observation of the page: URL, title, and indexed interactive elements.",
      inputSchema: z.object({ sessionId: z.string() }),
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      const { snapshot } = await serializePage(page);
      return textResult(formatSnapshotForLLM(snapshot));
    },
  );

  server.registerTool(
    "search_page",
    {
      description: "Search page text with literal/regex pattern and context.",
      inputSchema: z.object({
        sessionId: z.string(),
        pattern: z.string().min(1),
        regex: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        contextChars: z.number().int().positive().max(1000).optional(),
        cssScope: z.string().optional(),
        maxResults: z.number().int().positive().max(200).optional(),
      }),
    },
    async ({ sessionId, pattern, regex, caseSensitive, contextChars, cssScope, maxResults }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "search_page",
          params: {
            pattern,
            regex,
            caseSensitive,
            contextChars,
            cssScope,
            maxResults,
          },
        }),
      );
    },
  );

  server.registerTool(
    "find_elements",
    {
      description: "Find elements by CSS selector.",
      inputSchema: z.object({
        sessionId: z.string(),
        selector: z.string().min(1),
        attributes: z.array(z.string().min(1)).optional(),
        maxResults: z.number().int().positive().max(200).optional(),
        includeText: z.boolean().optional(),
      }),
    },
    async ({ sessionId, selector, attributes, maxResults, includeText }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "find_elements",
          params: { selector, attributes, maxResults, includeText },
        }),
      );
    },
  );

  server.registerTool(
    "get_dropdown_options",
    {
      description: "Get dropdown options from select element [index].",
      inputSchema: z.object({
        sessionId: z.string(),
        index: z.number().int().nonnegative(),
      }),
    },
    async ({ sessionId, index }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "get_dropdown_options",
          params: { index },
        }),
      );
    },
  );

  server.registerTool(
    "click",
    {
      description: "Click element by [index] or by viewport coordinates.",
      inputSchema: z.object({
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        coordinateX: z.number().int().optional(),
        coordinateY: z.number().int().optional(),
      }),
    },
    async ({ sessionId, index, coordinateX, coordinateY }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "click",
          params: { index, coordinateX, coordinateY },
        }),
      );
    },
  );

  server.registerTool(
    "type",
    {
      description:
        "Type text into element [index]. Set submit=true to press Enter. mode='replace' (default) clears the field first; mode='append' keeps the existing value.",
      inputSchema: z.object({
        sessionId: z.string(),
        index: z.number().int().nonnegative(),
        text: z.string(),
        submit: z.boolean().optional(),
        mode: z.enum(["replace", "append"]).optional(),
      }),
    },
    async ({ sessionId, index, text, submit, mode }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "type",
          params: { index, text, submit, mode: mode ?? "replace" },
        }),
      );
    },
  );

  server.registerTool(
    "scroll",
    {
      description: "Scroll the page.",
      inputSchema: z.object({
        sessionId: z.string(),
        direction: z.enum(["up", "down", "top", "bottom"]),
        amount: z.number().int().positive().optional(),
        pages: z.number().positive().max(10).optional(),
        index: z.number().int().nonnegative().optional(),
      }),
    },
    async ({ sessionId, direction, amount, pages, index }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "scroll", params: { direction, amount, pages, index } }),
      );
    },
  );

  server.registerTool(
    "screenshot",
    {
      description: "Capture a page screenshot (base64 PNG) or save to file.",
      inputSchema: z.object({ sessionId: z.string(), fileName: z.string().optional() }),
    },
    async ({ sessionId, fileName }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "screenshot", params: { fileName } }));
    },
  );

  server.registerTool(
    "find_text",
    {
      description: "Scroll to first visible occurrence of text.",
      inputSchema: z.object({ sessionId: z.string(), text: z.string().min(1) }),
    },
    async ({ sessionId, text }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "find_text", params: { text } }));
    },
  );

  server.registerTool(
    "save_as_pdf",
    {
      description: "Save current page as PDF file.",
      inputSchema: z.object({
        sessionId: z.string(),
        fileName: z.string().optional(),
        printBackground: z.boolean().optional(),
        landscape: z.boolean().optional(),
        scale: z.number().min(0.1).max(2).optional(),
        paperFormat: z.enum(["Letter", "Legal", "A4", "A3", "Tabloid"]).optional(),
      }),
    },
    async ({ sessionId, fileName, printBackground, landscape, scale, paperFormat }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "save_as_pdf",
          params: {
            fileName,
            printBackground,
            landscape,
            scale,
            paperFormat,
          },
        }),
      );
    },
  );

  server.registerTool(
    "extract_content",
    {
      description: "Extract page content chunk for a query with optional links/images.",
      inputSchema: z.object({
        sessionId: z.string(),
        query: z.string().min(1),
        extractLinks: z.boolean().optional(),
        extractImages: z.boolean().optional(),
        startFromChar: z.number().int().nonnegative().optional(),
        maxChars: z.number().int().positive().max(200_000).optional(),
      }),
    },
    async ({ sessionId, query, extractLinks, extractImages, startFromChar, maxChars }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "extract_content",
          params: {
            query,
            extractLinks,
            extractImages,
            startFromChar,
            maxChars,
          },
        }),
      );
    },
  );

  server.registerTool(
    "run_agent",
    {
      description:
        "Run an autonomous browser agent against a fresh browser session until the task is done. Prefer setting OPENAI_API_KEY/ANTHROPIC_API_KEY in env over passing apiKey here.",
      inputSchema: z.object({
        task: z.string(),
        startUrl: z.string().optional(),
        maxSteps: z.number().int().min(1).max(200).optional(),
        model: z.string().optional(),
        effort: z.string().optional(),
        headless: z.boolean().optional().default(true),
        provider: z.enum(["codex", "claude", "openai", "anthropic"]).optional().default("codex"),
        apiKey: z.string().optional(),
        baseUrl: z.string().optional(),
      }),
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

  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
