import { execFileSync } from "node:child_process";

import type { ResolvedCommand } from "../snippet";

export type ClaudeScope = "user" | "project" | "local";

export interface ClaudeInstallOptions {
  name: string;
  command: ResolvedCommand;
  scope?: ClaudeScope;
}

export interface ClaudeInstallResult {
  invocation: string;
}

function hasClaudeBin(): boolean {
  try {
    execFileSync("command", ["-v", "claude"], { stdio: "ignore", shell: "/bin/sh" });
    return true;
  } catch {
    return false;
  }
}

export function buildClaudeArgs(opts: ClaudeInstallOptions): string[] {
  const scope = opts.scope ?? "user";
  return [
    "mcp",
    "add",
    "--scope",
    scope,
    opts.name,
    "--",
    opts.command.command,
    ...opts.command.args,
  ];
}

export function installClaudeCode(opts: ClaudeInstallOptions): ClaudeInstallResult {
  if (!hasClaudeBin()) {
    throw new Error(
      "`claude` CLI not found on PATH. Install it from https://claude.com/claude-code first.",
    );
  }
  const args = buildClaudeArgs(opts);
  execFileSync("claude", args, { stdio: "inherit" });
  return { invocation: `claude ${args.join(" ")}` };
}
