/**
 * Structured logging interface used across the package.
 *
 * Built-in components (transport resolution, agent loop) emit logs through
 * an injected Logger so SDK consumers can pipe them into their own logging
 * system instead of being forced to read raw stderr.
 *
 * Each method takes an event name (stable, machine-readable) plus optional
 * structured data. The default implementation writes JSONL to stderr; pass
 * `noopLogger` to silence everything, or supply a custom shape.
 */
export interface Logger {
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

interface DefaultLoggerOptions {
  /** Minimum level to emit. Default: "info". */
  minLevel?: LogLevel;
  /** Override the destination. Default: process.stderr.write. */
  write?: (line: string) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** JSONL-to-stderr Logger. The default for built-in callers. */
export function createDefaultLogger(options: DefaultLoggerOptions = {}): Logger {
  const minLevel = options.minLevel ?? "info";
  const minOrder = LEVEL_ORDER[minLevel];
  const write = options.write ?? ((line) => process.stderr.write(line));

  function emit(level: LogLevel, event: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < minOrder) return;
    const payload = {
      level,
      event,
      ts: new Date().toISOString(),
      ...data,
    };
    write(`${JSON.stringify(payload)}\n`);
  }

  return {
    debug: (event, data) => emit("debug", event, data),
    info: (event, data) => emit("info", event, data),
    warn: (event, data) => emit("warn", event, data),
    error: (event, data) => emit("error", event, data),
  };
}

/** Logger that drops every event. Useful in tests and embedded consumers. */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};
