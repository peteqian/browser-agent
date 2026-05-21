import { BrowserSession, type BrowserStateSummary, type Page } from "@peteqian/browser-agent-sdk";

export type ArtifactKind = "screenshot" | "pdf";

export interface SessionArtifact {
  kind: ArtifactKind;
  path: string;
  createdAt: number;
}

export type SessionEventKind = "lifecycle" | "action";

export interface SessionEvent {
  id: number;
  kind: SessionEventKind;
  name: string;
  createdAt: number;
  ok?: boolean;
  message?: string;
  durationMs?: number;
  url?: string;
}

export type SessionEventListener = (event: { sessionId?: string; event: SessionEvent }) => void;

export interface SessionRecord {
  session: BrowserSession;
  page: Page;
  createdAt?: number;
  lastAccessedAt: number;
  artifacts: SessionArtifact[];
  events?: SessionEvent[];
  nextEventId?: number;
  latestState?: BrowserStateSummary;
  profile?: string;
  userDataDir?: string;
  storageStatePath?: string;
  allowedDomains?: readonly string[];
}

const sessions = new Map<string, SessionRecord>();
let sessionCounter = 0;
const eventListeners = new Set<SessionEventListener>();

const MCP_SESSION_TTL_MS = Number(process.env.MCP_SESSION_TTL_MS ?? 30 * 60 * 1000);
const MCP_SESSION_SWEEP_MS = Number(process.env.MCP_SESSION_SWEEP_MS ?? 10 * 60 * 1000);
const MCP_SESSION_EVENT_LIMIT = Number(process.env.MCP_SESSION_EVENT_LIMIT ?? 200);
let sweepTimer: ReturnType<typeof setInterval> | undefined;

export function nextSessionId(): string {
  sessionCounter += 1;
  return `sess_${Date.now().toString(36)}_${sessionCounter}`;
}

export function registerSession(id: string, record: SessionRecord): void {
  sessions.set(id, record);
}

export function listSessionRecords(): Array<[string, SessionRecord]> {
  return Array.from(sessions.entries());
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

export function findSessionByProfile(profile: string): [string, SessionRecord] | undefined {
  const normalized = profile.trim();
  return listSessionRecords()
    .filter(([, record]) => record.profile === normalized)
    .toSorted(
      ([, a], [, b]) =>
        (b.lastAccessedAt ?? b.createdAt ?? 0) - (a.lastAccessedAt ?? a.createdAt ?? 0),
    )[0];
}

export function recordSessionEvent(
  record: SessionRecord,
  event: Omit<SessionEvent, "id" | "createdAt"> & { createdAt?: number },
  sessionId?: string,
): SessionEvent {
  const createdAt = event.createdAt ?? Date.now();
  const id = record.nextEventId ?? 1;
  record.nextEventId = id + 1;
  const stored: SessionEvent = { ...event, id, createdAt };
  record.events ??= [];
  record.events.push(stored);
  if (record.events.length > MCP_SESSION_EVENT_LIMIT) {
    record.events.splice(0, record.events.length - MCP_SESSION_EVENT_LIMIT);
  }
  for (const listener of eventListeners) listener({ sessionId, event: stored });
  return stored;
}

export function listSessionEvents(record: SessionRecord, limit = 50): SessionEvent[] {
  const events = record.events ?? [];
  return events.slice(Math.max(0, events.length - limit));
}

export function subscribeSessionEvents(listener: SessionEventListener): () => void {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
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
