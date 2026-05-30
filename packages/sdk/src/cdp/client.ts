import { WebSocket } from "ws";
import type ProtocolMapping from "devtools-protocol/types/protocol-mapping";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type EventHandler<TParams = unknown> = (params: TParams, sessionId?: string) => void;

export type CDPCommand = keyof ProtocolMapping.Commands;
export type CDPEvent = keyof ProtocolMapping.Events;

type CommandParams<M extends CDPCommand> = ProtocolMapping.Commands[M] extends {
  paramsType: infer P;
}
  ? P extends readonly [unknown, ...unknown[]]
    ? P[0]
    : Record<string, unknown>
  : never;

type CommandResult<M extends CDPCommand> = ProtocolMapping.Commands[M] extends {
  returnType: infer R;
}
  ? R
  : never;

type EventParams<M extends CDPEvent> = ProtocolMapping.Events[M] extends readonly [infer P]
  ? P
  : ProtocolMapping.Events[M] extends readonly []
    ? undefined
    : never;

export interface CDPMessage {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
  sessionId?: string;
}

export class CDPClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private closeHandlers = new Set<(reason?: string) => void>();
  private ready: Promise<void>;
  private closed = false;
  private expectedClose = false;

  constructor(wsUrl: string) {
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.once("open", () => resolve());
      this.ws.once("error", (error) => reject(error));
    });
    this.ws.on("message", (data) => this.handleMessage(data.toString()));
    this.ws.on("close", (code, reason) => {
      this.closed = true;
      const reasonText = typeof reason === "string" ? reason : reason.toString();
      const detail = reasonText.length > 0 ? `code=${code} reason=${reasonText}` : `code=${code}`;
      if (!this.expectedClose) {
        this.rejectPending(new Error(`CDP websocket closed (${detail})`));
      }
      for (const handler of this.closeHandlers) {
        handler(reasonText);
      }
    });
    this.ws.on("error", (error) => {
      this.rejectPending(error instanceof Error ? error : new Error(String(error)));
    });
  }

  async waitForOpen() {
    await this.ready;
  }

  private handleMessage(raw: string) {
    let msg: CDPMessage;
    try {
      msg = JSON.parse(raw) as CDPMessage;
    } catch {
      return;
    }

    if (typeof msg.id === "number") {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);

      if (msg.error) {
        pending.reject(new Error(`CDP error ${msg.error.code}: ${msg.error.message}`));
        return;
      }
      pending.resolve(msg.result);
      return;
    }

    if (msg.method) {
      const handlers = this.eventHandlers.get(msg.method);
      if (!handlers) return;
      for (const handler of handlers) {
        handler(msg.params, msg.sessionId);
      }
    }
  }

  private rejectPending(error: Error): void {
    if (this.pending.size === 0) return;
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id);
      pending.reject(error);
    }
  }

  send<M extends CDPCommand>(
    method: M,
    params?: CommandParams<M>,
    sessionId?: string,
  ): Promise<CommandResult<M>>;
  send<TResult = unknown>(
    method: string,
    params?: Record<string, unknown>,
    sessionId?: string,
  ): Promise<TResult>;
  send(method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<unknown> {
    if (this.closed || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error(`Cannot send CDP command ${method}: websocket not open`));
    }

    const id = this.nextId++;
    const payload: CDPMessage = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
    });
  }

  on<M extends CDPEvent>(method: M, handler: EventHandler<EventParams<M>>): () => void;
  on(method: string, handler: EventHandler): () => void;
  on(method: string, handler: EventHandler): () => void {
    let handlers = this.eventHandlers.get(method);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(method, handlers);
    }
    handlers.add(handler);

    return () => {
      handlers?.delete(handler);
    };
  }

  onClose(handler: (reason?: string) => void): () => void {
    this.closeHandlers.add(handler);
    return () => {
      this.closeHandlers.delete(handler);
    };
  }

  isOpen(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  close() {
    if (this.closed) return;
    this.expectedClose = true;
    this.closed = true;
    this.rejectPending(new Error("CDP client closed"));
    this.ws.close();
    this.eventHandlers.clear();
    this.closeHandlers.clear();
  }
}
