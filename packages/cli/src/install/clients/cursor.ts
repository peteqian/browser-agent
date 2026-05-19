import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ResolvedCommand } from "../snippet";

export type CursorScope = "user" | "project";

export interface CursorInstallOptions {
  name: string;
  command: ResolvedCommand;
  scope?: CursorScope;
  cwd?: string;
  configPath?: string;
}

export interface CursorInstallResult {
  path: string;
  action: "added" | "replaced";
}

interface CursorConfig {
  mcpServers?: Record<string, { command: string; args: string[] }>;
}

export function resolveCursorPath(scope: CursorScope, cwd: string, home: string): string {
  return scope === "project" ? join(cwd, ".cursor/mcp.json") : join(home, ".cursor/mcp.json");
}

export function installCursor(opts: CursorInstallOptions): CursorInstallResult {
  const scope = opts.scope ?? "user";
  const path =
    opts.configPath ?? resolveCursorPath(scope, opts.cwd ?? process.cwd(), homedir());

  const parsed: CursorConfig = existsSync(path)
    ? (JSON.parse(readFileSync(path, "utf8")) as CursorConfig)
    : {};

  parsed.mcpServers ??= {};
  const action = parsed.mcpServers[opts.name] ? "replaced" : "added";
  parsed.mcpServers[opts.name] = { command: opts.command.command, args: opts.command.args };

  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(parsed, null, 2) + "\n");
  renameSync(tmp, path);

  return { path, action };
}
