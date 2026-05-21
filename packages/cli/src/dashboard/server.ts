import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { URL } from "node:url";
import { ZodError } from "zod";

import { BrowserSession } from "@peteqian/browser-agent-sdk";

import { refreshSessionState, runSessionAction, runSessionActions } from "../mcp/helpers";
import {
  ensureSweeper,
  deleteSession,
  findSessionByProfile,
  getSession,
  listSessionEvents,
  listSessionRecords,
  nextSessionId,
  recordSessionEvent,
  registerSession,
  subscribeSessionEvents,
  type SessionRecord,
} from "../mcp/sessions";
import { browserAgentHome, resolveBrowserPaths } from "../profiles";
import { dashboardHtml } from "./html";
export { dashboardHtml } from "./html";
import {
  actionSchemas,
  parseAllowedDomainsInput,
  type Action,
  type BrowserChannel,
} from "@peteqian/browser-agent-sdk/internal";

const BROWSER_CHANNELS: readonly BrowserChannel[] = [
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
];

export interface DashboardOptions {
  host?: string;
  port?: number;
  writeManifest?: boolean;
}

export interface DashboardHandle {
  url: string;
  close: () => Promise<void>;
}

export interface DashboardManifest {
  pid: number;
  url: string;
  startedAt: string;
}

export type DashboardStatus =
  | ({ running: true; health: unknown } & DashboardManifest)
  | (({ running: false; reason: "missing_manifest" } | { running: false; error: string }) &
      Partial<DashboardManifest>);

export async function runDashboard(options: DashboardOptions = {}): Promise<DashboardHandle> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 3217;
  const server = createServer((req, res) => {
    void handleRequest(req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const url = `http://${host}:${address.port}`;
  if (options.writeManifest !== false)
    writeDashboardManifest({ pid: process.pid, url, startedAt: new Date().toISOString() });
  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => {
          removeDashboardManifest(process.pid);
          return error ? reject(error) : resolve();
        });
      }),
  };
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  try {
    if (req.method === "GET" && url.pathname === "/") return html(res, dashboardHtml());
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, {
        ok: true,
        pid: process.pid,
        sessions: listSessionRecords().length,
        uptimeMs: Math.round(process.uptime() * 1000),
      });
    }
    if (req.method === "GET" && url.pathname === "/api/events") return streamEvents(req, res);
    if (req.method === "GET" && url.pathname === "/api/sessions") {
      return json(res, { sessions: await sessionSummaries() });
    }
    if (req.method === "POST" && url.pathname === "/api/sessions") {
      return json(res, await launchSession(await readJson(req)));
    }
    if (req.method === "POST" && url.pathname === "/api/sessions/attach") {
      return json(res, await attachSession(await readJson(req)));
    }
    const closeMatch = /^\/api\/sessions\/([^/]+)$/.exec(url.pathname);
    if (req.method === "DELETE" && closeMatch?.[1]) {
      return json(res, await closeSession(closeMatch[1]));
    }
    const match = /^\/api\/sessions\/([^/]+)\/(events|snapshot|action|actions|artifacts)$/.exec(
      url.pathname,
    );
    if (req.method === "GET" && match?.[1] && match[2] === "events") {
      const limit = Number(url.searchParams.get("limit") ?? 50);
      return json(res, { events: listSessionEvents(getSession(match[1]), clampLimit(limit)) });
    }
    if (req.method === "GET" && match?.[1] && match[2] === "snapshot") {
      const record = getSession(match[1]);
      const state = await refreshSessionState(record);
      return json(res, {
        sessionId: match[1],
        observation: state.observation,
        url: state.url,
        title: state.title,
        readyState: state.readyState,
        elements: state.elements.length,
      });
    }
    if (req.method === "GET" && match?.[1] && match[2] === "artifacts") {
      return json(res, listArtifacts(match[1], url.searchParams.get("kind")));
    }
    if (req.method === "POST" && match?.[1] && match[2] === "action") {
      return json(res, await runHttpAction(match[1], await readJson(req)));
    }
    if (req.method === "POST" && match?.[1] && match[2] === "actions") {
      return json(res, await runHttpActions(match[1], await readJson(req)));
    }
    notFound(res);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    json(res, { error: message }, statusForError(error));
  }
}

async function attachSession(input: unknown) {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const sessionId = typeof body.sessionId === "string" ? body.sessionId : undefined;
  const profile = typeof body.profile === "string" ? body.profile : undefined;
  if (!sessionId && !profile) throw new Error("Provide sessionId or profile.");
  const resolved = sessionId
    ? ([sessionId, getSession(sessionId)] as const)
    : findSessionByProfile(profile as string);
  if (!resolved) throw new Error(`No live session for profile: ${profile}`);
  const [attachedSessionId, record] = resolved;
  recordSessionEvent(
    record,
    { kind: "lifecycle", name: "attach_session", ok: true },
    attachedSessionId,
  );
  await refreshSessionState(record);
  return {
    ...(await sessionSummary(attachedSessionId, record)),
    observation: record.latestState?.observation,
  };
}

async function closeSession(sessionId: string) {
  const record = getSession(sessionId);
  try {
    await record.session.close();
    recordSessionEvent(record, { kind: "lifecycle", name: "close_session", ok: true }, sessionId);
  } finally {
    deleteSession(sessionId);
  }
  return { sessionId, closed: true };
}

async function runHttpAction(sessionId: string, input: unknown) {
  const action = parseAction(input);
  return responseBody(await runSessionAction(getSession(sessionId), action, { sessionId }));
}

async function runHttpActions(sessionId: string, input: unknown) {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const values = Array.isArray(body.actions) ? body.actions : [];
  return responseBody(
    await runSessionActions(getSession(sessionId), values.map(parseAction), { sessionId }),
  );
}

function parseAction(input: unknown): Action {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const name = body.name;
  if (typeof name !== "string" || !(name in actionSchemas)) throw new Error("Invalid action name.");
  const params = (body.params ?? {}) as unknown;
  const parsed = actionSchemas[name as keyof typeof actionSchemas].parse(params);
  return { name, params: parsed } as Action;
}

function responseBody(result: { content: Array<{ type: "text"; text: string }> }) {
  const text = result.content.find((item) => item.type === "text")?.text ?? "{}";
  return JSON.parse(text);
}

function listArtifacts(sessionId: string, kind: string | null) {
  if (kind !== null && kind !== "screenshot" && kind !== "pdf") {
    throw new Error(`Unsupported artifact kind: ${kind}`);
  }
  const artifacts = getSession(sessionId).artifacts;
  return { artifacts: kind ? artifacts.filter((item) => item.kind === kind) : artifacts };
}

export function dashboardManifestPath(): string {
  return join(browserAgentHome(), "daemon.json");
}

export function readDashboardManifest(): DashboardManifest | null {
  const path = dashboardManifestPath();
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Partial<DashboardManifest>;
    if (typeof parsed.pid !== "number" || typeof parsed.url !== "string") return null;
    return {
      pid: parsed.pid,
      url: parsed.url,
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
    };
  } catch {
    return null;
  }
}

export async function getDashboardStatus(options: { cleanStale?: boolean } = {}) {
  const manifest = readDashboardManifest();
  if (!manifest) return { running: false, reason: "missing_manifest" } satisfies DashboardStatus;
  try {
    const response = await fetch(`${manifest.url}/api/health`);
    const health = await response.json();
    if (!response.ok) throw new Error(`Health check failed: ${response.status}`);
    return { running: true, ...manifest, health } satisfies DashboardStatus;
  } catch (error) {
    if (options.cleanStale) removeDashboardManifest(manifest.pid, manifest);
    const message = error instanceof Error ? error.message : String(error);
    return { running: false, ...manifest, error: message } satisfies DashboardStatus;
  }
}

function writeDashboardManifest(manifest: DashboardManifest): void {
  const path = dashboardManifestPath();
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
}

function removeDashboardManifest(pid: number, expected?: DashboardManifest): void {
  const manifest = readDashboardManifest();
  if (!manifest || manifest.pid !== pid) return;
  if (expected && (manifest.url !== expected.url || manifest.startedAt !== expected.startedAt)) {
    return;
  }
  unlinkSync(dashboardManifestPath());
}

async function launchSession(input: unknown) {
  const body = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const profile = typeof body.profile === "string" ? body.profile : undefined;
  const userDataDir = typeof body.userDataDir === "string" ? body.userDataDir : undefined;
  const storageStatePath =
    typeof body.storageStatePath === "string" ? body.storageStatePath : undefined;
  const saveStorageStateOnClose =
    typeof body.saveStorageStateOnClose === "boolean" ? body.saveStorageStateOnClose : undefined;
  const startUrl = typeof body.startUrl === "string" ? body.startUrl : undefined;
  const headless = typeof body.headless === "boolean" ? body.headless : true;
  const autoConsent = typeof body.autoConsent === "boolean" ? body.autoConsent : true;
  const executablePath = typeof body.executablePath === "string" ? body.executablePath : undefined;
  const channel = parseBrowserChannel(body.channel);
  const locale = typeof body.locale === "string" ? body.locale : undefined;
  const timezoneId = typeof body.timezoneId === "string" ? body.timezoneId : undefined;
  const acceptLanguage = typeof body.acceptLanguage === "string" ? body.acceptLanguage : undefined;
  const allowedDomains = parseAllowedDomainsInput(body.allowedDomains);
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
  const record: SessionRecord = {
    session,
    page,
    createdAt: now,
    lastAccessedAt: now,
    artifacts: [],
    profile: paths.profile,
    userDataDir: paths.userDataDir,
    storageStatePath: paths.storageStatePath,
    allowedDomains,
  };
  registerSession(sessionId, record);
  recordSessionEvent(record, { kind: "lifecycle", name: "launch_session", ok: true }, sessionId);
  ensureSweeper();
  let navigation: unknown;
  if (startUrl) navigation = await page.navigateWithHealthCheck(startUrl);
  await refreshSessionState(record);
  return {
    ...(await sessionSummary(sessionId, record)),
    ...(navigation ? { navigation } : {}),
    observation: record.latestState?.observation,
  };
}

function parseBrowserChannel(value: unknown): BrowserChannel | undefined {
  if (typeof value !== "string") return undefined;
  if (BROWSER_CHANNELS.includes(value as BrowserChannel)) return value as BrowserChannel;
  throw new Error(`Unsupported browser channel: ${value}`);
}

export function statusForError(error: unknown): number {
  if (error instanceof SyntaxError) return 400;
  if (error instanceof ZodError) return 400;
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith("Unknown sessionId:")) return 404;
  if (message.startsWith("No live session for profile:")) return 404;
  if (
    message === "Provide sessionId or profile." ||
    message === "Invalid action name." ||
    message.startsWith("Unsupported artifact kind:") ||
    message.startsWith("Unsupported browser channel:") ||
    message.startsWith("Profile must be ")
  ) {
    return 400;
  }
  return 500;
}

async function sessionSummaries() {
  return Promise.all(listSessionRecords().map(([id, record]) => sessionSummary(id, record)));
}

async function sessionSummary(sessionId: string, record: SessionRecord) {
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
    sessionId,
    createdAt: record.createdAt ?? record.lastAccessedAt,
    lastAccessedAt: record.lastAccessedAt,
    activeTargetId: record.page.targetId,
    targetIds,
    eventCount: record.events?.length ?? 0,
    artifactCount: record.artifacts.length,
    ...(url ? { url } : {}),
    ...(record.profile ? { profile: record.profile } : {}),
  };
}

function streamEvents(req: IncomingMessage, res: ServerResponse): void {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  const unsubscribe = subscribeSessionEvents((event) => {
    res.write(`event: session_event\ndata: ${JSON.stringify(event)}\n\n`);
  });
  req.on("close", unsubscribe);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) return 50;
  return Math.min(Math.max(Math.floor(limit), 1), 200);
}

function json(res: ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(`${JSON.stringify(value)}\n`);
}

function html(res: ServerResponse, content: string): void {
  res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  res.end(content);
}

function notFound(res: ServerResponse): void {
  json(res, { error: "not_found" }, 404);
}

