import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { executeAction } from "../../actions/execute";
import { BrowserSession } from "../../browser/session";
import { jsonResult } from "../helpers";
import {
  deleteSession,
  ensureSweeper,
  getSession,
  nextSessionId,
  registerSession,
  setCurrentPage,
} from "../sessions";

export function registerSessionTools(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;
  registerTool(
    "launch_session",
    {
      description: "Launch a Chromium session. Returns sessionId for subsequent tool calls.",
      inputSchema: {
        headless: z.boolean().optional().default(true),
        startUrl: z.string().optional(),
      },
    },
    async ({ headless, startUrl }) => {
      const session = await BrowserSession.launch({ headless });
      const page = await session.newPage();
      const sessionId = nextSessionId();
      registerSession(sessionId, {
        session,
        page,
        lastAccessedAt: Date.now(),
        artifacts: [],
      });
      ensureSweeper();
      if (startUrl) {
        await page.goto(startUrl);
      }
      return jsonResult({ sessionId });
    },
  );

  registerTool(
    "new_tab",
    {
      description: "Open a new tab and optionally navigate to URL. Makes the new tab active.",
      inputSchema: { sessionId: z.string(), url: z.string().url().optional() },
    },
    async ({ sessionId, url }) => {
      const record = getSession(sessionId);
      const page = await record.session.newPage();
      if (url) await page.goto(url);
      record.page = page;
      return jsonResult({ targetId: page.targetId, active: true });
    },
  );

  registerTool(
    "list_tabs",
    {
      description: "List open tab target IDs and active target ID.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      const record = getSession(sessionId);
      const targetIds = await record.session.listPageTargetIds();
      return jsonResult({ targetIds, activeTargetId: record.page.targetId });
    },
  );

  registerTool(
    "switch_tab",
    {
      description: "Switch active tab by targetId or pageId.",
      inputSchema: {
        sessionId: z.string(),
        targetId: z.string().min(1).optional(),
        pageId: z.number().int().nonnegative().optional(),
      },
    },
    async ({ sessionId, targetId, pageId }) => {
      const record = getSession(sessionId);
      const result = await executeAction(
        record.page,
        { name: "switch_tab", params: { targetId, pageId } },
        record.session,
      );
      if (result.activeTargetId) setCurrentPage(record, result.activeTargetId);
      return jsonResult(result);
    },
  );

  registerTool(
    "close_tab",
    {
      description: "Close tab by targetId, pageId, or active tab when omitted.",
      inputSchema: {
        sessionId: z.string(),
        targetId: z.string().optional(),
        pageId: z.number().int().nonnegative().optional(),
      },
    },
    async ({ sessionId, targetId, pageId }) => {
      const record = getSession(sessionId);
      const result = await executeAction(
        record.page,
        { name: "close_tab", params: { targetId, pageId } },
        record.session,
      );
      if (result.activeTargetId) setCurrentPage(record, result.activeTargetId);
      return jsonResult(result);
    },
  );

  registerTool(
    "close_session",
    {
      description: "Close a Chromium session and release resources.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      const record = getSession(sessionId);
      await record.session.close();
      deleteSession(sessionId);
      return jsonResult({ closed: true });
    },
  );

  registerTool(
    "close_browser",
    {
      description: "Close a Chromium browser session and release resources.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      const record = getSession(sessionId);
      const result = await executeAction(
        record.page,
        { name: "close_browser", params: {} },
        record.session,
      );
      deleteSession(sessionId);
      return jsonResult(result);
    },
  );

  registerTool(
    "list_artifacts",
    {
      description:
        "List filesystem artifacts (screenshots, PDFs) saved during this session, in creation order.",
      inputSchema: {
        sessionId: z.string(),
        kind: z.enum(["screenshot", "pdf"]).optional(),
      },
    },
    async ({ sessionId, kind }) => {
      const record = getSession(sessionId);
      const items = kind ? record.artifacts.filter((a) => a.kind === kind) : record.artifacts;
      return jsonResult({ artifacts: items });
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
