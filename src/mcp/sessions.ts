import { BrowserSession, type Page } from "../browser/session";

export type ArtifactKind = "screenshot" | "pdf";

export interface SessionArtifact {
  kind: ArtifactKind;
  path: string;
  createdAt: number;
}

export interface SessionRecord {
  session: BrowserSession;
  page: Page;
  lastAccessedAt: number;
  artifacts: SessionArtifact[];
}

const sessions = new Map<string, SessionRecord>();
let sessionCounter = 0;

const MCP_SESSION_TTL_MS = Number(process.env.MCP_SESSION_TTL_MS ?? 30 * 60 * 1000);
const MCP_SESSION_SWEEP_MS = Number(process.env.MCP_SESSION_SWEEP_MS ?? 10 * 60 * 1000);
let sweepTimer: ReturnType<typeof setInterval> | undefined;

export function nextSessionId(): string {
  sessionCounter += 1;
  return `sess_${Date.now().toString(36)}_${sessionCounter}`;
}

export function registerSession(id: string, record: SessionRecord): void {
  sessions.set(id, record);
}

export function deleteSession(id: string): void {
  sessions.delete(id);
}

export function getSession(sessionId: string): SessionRecord {
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

export function ensureSweeper(): void {
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

export function setCurrentPage(record: SessionRecord, targetId: string): void {
  record.page = record.session.getPage(targetId);
}

/**
 * Pull a filesystem path out of an executeAction result and record it on the
 * session. screenshot/save_as_pdf both surface `data.path` when they write to
 * disk; ignore in-memory variants (e.g. base64-only screenshots).
 */
export function recordArtifact(
  record: { artifacts: SessionArtifact[] },
  kind: ArtifactKind,
  result: unknown,
  now: number = Date.now(),
): SessionArtifact | undefined {
  if (!result || typeof result !== "object") return undefined;
  const data = (result as { data?: unknown }).data;
  if (!data || typeof data !== "object") return undefined;
  const path = (data as { path?: unknown }).path;
  if (typeof path !== "string" || path.length === 0) return undefined;
  const artifact: SessionArtifact = { kind, path, createdAt: now };
  record.artifacts.push(artifact);
  return artifact;
}
