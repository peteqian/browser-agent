import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

import type { ResolvedCommand } from "../snippet";

export interface CodexInstallOptions {
  name: string;
  command: ResolvedCommand;
  configPath?: string;
  startupTimeoutSec?: number;
}

export interface CodexInstallResult {
  path: string;
  action: "added" | "replaced";
  block: string;
}

function renderArgs(args: string[]): string {
  return `[${args.map((a) => JSON.stringify(a)).join(", ")}]`;
}

export function renderBlock(opts: CodexInstallOptions): string {
  const { name, command, startupTimeoutSec = 20 } = opts;
  return [
    `[mcp_servers.${name}]`,
    `command = ${JSON.stringify(command.command)}`,
    `args = ${renderArgs(command.args)}`,
    `startup_timeout_sec = ${startupTimeoutSec}`,
    "",
  ].join("\n");
}

/**
 * Insert or replace `[mcp_servers.<name>]` in ~/.codex/config.toml.
 * Text-level edit: preserves everything outside this table.
 */
export function installCodex(opts: CodexInstallOptions): CodexInstallResult {
  const path = opts.configPath ?? join(homedir(), ".codex/config.toml");
  const block = renderBlock(opts);
  const header = `[mcp_servers.${opts.name}]`;

  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";

  let next: string;
  let action: "added" | "replaced";

  const headerIdx = existing.indexOf(header);
  if (headerIdx === -1) {
    next = existing.length === 0 || existing.endsWith("\n") ? existing : existing + "\n";
    next += (next.length > 0 && !next.endsWith("\n\n") ? "\n" : "") + block;
    action = "added";
  } else {
    const before = existing.slice(0, headerIdx);
    const rest = existing.slice(headerIdx);
    const nextHeader = rest.slice(header.length).search(/\n\[/);
    const tail = nextHeader === -1 ? "" : rest.slice(header.length + nextHeader + 1);
    next = before + block + (tail.startsWith("\n") ? "" : "\n") + tail;
    action = "replaced";
  }

  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, next);
  renameSync(tmp, path);

  return { path, action, block };
}
