import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { executeAction } from "@peteqian/browser-agent-sdk/internal";
import { BrowserSession } from "@peteqian/browser-agent-sdk";
import { actionResult, jsonResult, runSessionAction } from "../helpers";
import { resolveBrowserPaths } from "../../profiles";
import {
  deleteSession,
  ensureSweeper,
  findSessionByProfile,
  getSession,
  listSessionEvents,
  listSessionRecords,
  nextSessionId,
  registerSession,
  recordSessionEvent,
  type SessionRecord,
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
        autoConsent: z.boolean().optional().default(true),
        profile: z.string().min(1).optional(),
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
        allowedDomains: z.array(z.string().min(1)).optional(),
      },
    },
    async ({
      headless,
      startUrl,
      autoConsent,
      profile,
      userDataDir,
      storageStatePath,
      saveStorageStateOnClose,
      executablePath,
      channel,
      locale,
      timezoneId,
      acceptLanguage,
      allowedDomains,
    }) => {
      const paths = resolveBrowserPaths({ profile, userDataDir, storageStatePath });
      const session = await BrowserSession.launch({
        headless,
        autoConsent,
        userDataDir: paths.userDataDir,
        storageStatePath: paths.storageStatePath,
        saveStorageStateOnClose,
        executablePath,
        channel,
        locale,
        timezoneId,
        acceptLanguage,
      });
      const page = await session.newPage();
      const sessionId = nextSessionId();
      const now = Date.now();
      const record = {
        session,
        page,
        createdAt: now,
        lastAccessedAt: now,
        artifacts: [],
        profile: paths.profile,
        userDataDir: paths.userDataDir,
        storageStatePath: paths.storageStatePath,
        allowedDomains: allowedDomains && allowedDomains.length > 0 ? allowedDomains : undefined,
      };
      registerSession(sessionId, record);
      recordSessionEvent(
        record,
        { kind: "lifecycle", name: "launch_session", ok: true },
        sessionId,
      );
      ensureSweeper();
      let navigation: unknown;
      if (startUrl) {
        navigation = await page.navigateWithHealthCheck(startUrl);
      }
      return actionResult(record, { sessionId, ...(navigation ? { navigation } : {}) });
    },
  );

  registerTool(
    "list_sessions",
    {
      description: "List live sessions currently held by this MCP daemon.",
      inputSchema: {},
    },
    async () => {
      const sessions = await Promise.all(
        listSessionRecords().map(async ([sessionId, record]) => ({
          sessionId,
          ...(await sessionSummary(record)),
        })),
      );
      return jsonResult({ sessions });
    },
  );

  registerTool(
    "attach_session",
    {
      description:
        "Attach to a live session by sessionId or by named profile. Returns the current observation.",
      inputSchema: {
        sessionId: z.string().optional(),
        profile: z.string().min(1).optional(),
      },
    },
    async ({ sessionId, profile }) => {
      if (!sessionId && !profile) throw new Error("Provide sessionId or profile.");
      const resolved = sessionId
        ? ([sessionId, getSession(sessionId)] as const)
        : findSessionByProfile(profile as string);
      if (!resolved) throw new Error(`No live session for profile: ${profile}`);
      const [attachedSessionId, record] = resolved;
      record.lastAccessedAt = Date.now();
      recordSessionEvent(
        record,
        { kind: "lifecycle", name: "attach_session", ok: true },
        attachedSessionId,
      );
      return actionResult(record, {
        attached: true,
        sessionId: attachedSessionId,
        ...(await sessionSummary(record)),
      });
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
      record.latestState = undefined;
      recordSessionEvent(record, { kind: "lifecycle", name: "new_tab", ok: true }, sessionId);
      return actionResult(record, { targetId: page.targetId, active: true });
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
      return runSessionAction(
        record,
        { name: "switch_tab", params: { targetId, pageId } },
        { sessionId },
      );
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
      return runSessionAction(
        record,
        { name: "close_tab", params: { targetId, pageId } },
        { sessionId },
      );
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
      recordSessionEvent(record, { kind: "lifecycle", name: "close_session", ok: true }, sessionId);
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
      recordSessionEvent(
        record,
        {
          kind: "lifecycle",
          name: "close_browser",
          ok: result.ok,
          message: result.message,
        },
        sessionId,
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

  registerTool(
    "list_session_events",
    {
      description: "List recent lifecycle/action events recorded for a live session.",
      inputSchema: {
        sessionId: z.string(),
        limit: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ sessionId, limit }) => {
      const record = getSession(sessionId);
      return jsonResult({ events: listSessionEvents(record, limit ?? 50) });
    },
  );
}

async function sessionSummary(record: SessionRecord) {
  let url = record.latestState?.url;
  if (!url) {
    try {
      url = await record.page.currentUrl();
    } catch {
      url = undefined;
    }
  }
  let targetIds: string[] = [];
  try {
    targetIds = await record.session.listPageTargetIds();
  } catch {
    targetIds = [];
  }
  return {
    createdAt: record.createdAt ?? record.lastAccessedAt,
    lastAccessedAt: record.lastAccessedAt,
    activeTargetId: record.page.targetId,
    targetIds,
    eventCount: record.events?.length ?? 0,
    ...(url ? { url } : {}),
    ...(record.profile ? { profile: record.profile } : {}),
    ...(record.userDataDir ? { userDataDir: record.userDataDir } : {}),
    ...(record.storageStatePath ? { storageStatePath: record.storageStatePath } : {}),
  };
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
