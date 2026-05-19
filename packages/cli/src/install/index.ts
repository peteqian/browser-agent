import * as p from "@clack/prompts";

import { installClaudeCode, type ClaudeScope } from "./clients/claude-code";
import { installCodex, renderBlock } from "./clients/codex";
import { installCursor, resolveCursorPath, type CursorScope } from "./clients/cursor";
import { detectClients, type ClientId } from "./detect";
import { findLocalCheckout, resolveSource } from "./source";
import { DEFAULT_SERVER_NAME, type ResolvedCommand, type SourceId } from "./snippet";

export interface InstallOptions {
  clients?: ClientId[];
  scope?: "user" | "project";
  source?: SourceId;
  name?: string;
  print?: boolean;
  allDetected?: boolean;
  interactive?: boolean;
}

export interface InstallResult {
  client: ClientId;
  ok: boolean;
  message: string;
}

type ClientChoice = { id: ClientId; scope: "user" | "project" };

function renderClaude(name: string, scope: ClaudeScope, cmd: ResolvedCommand): string {
  const parts = ["claude", "mcp", "add", "--scope", scope, name, "--", cmd.command, ...cmd.args];
  return parts.map((arg) => (/\s/.test(arg) ? JSON.stringify(arg) : arg)).join(" ");
}

function renderCursor(name: string, cmd: ResolvedCommand): string {
  return JSON.stringify(
    { mcpServers: { [name]: { command: cmd.command, args: cmd.args } } },
    null,
    2,
  );
}

function printSnippets(name: string, choices: ClientChoice[], cmd: ResolvedCommand): void {
  for (const { id, scope } of choices) {
    if (id === "codex") {
      console.log(`# Codex (~/.codex/config.toml)`);
      console.log(renderBlock({ name, command: cmd }));
    } else if (id === "claude-code") {
      console.log(`# Claude Code`);
      console.log(renderClaude(name, scope, cmd));
      console.log();
    } else if (id === "cursor") {
      const path = scope === "project" ? "./.cursor/mcp.json" : "~/.cursor/mcp.json";
      console.log(`# Cursor (${path})`);
      console.log(renderCursor(name, cmd));
      console.log();
    }
  }
}

async function pickClients(detected: ReturnType<typeof detectClients>): Promise<ClientId[]> {
  const result = await p.multiselect<ClientId>({
    message: "Install browser-agent into:",
    options: detected.map((d) => ({
      value: d.id,
      label: `${d.label}${d.detected ? "" : "  (not detected)"}`,
      hint: d.reason,
    })),
    initialValues: detected.filter((d) => d.detected).map((d) => d.id),
    required: true,
  });
  if (p.isCancel(result)) {
    p.cancel("aborted");
    process.exit(130);
  }
  return result;
}

async function pickScope(client: ClientId): Promise<"user" | "project"> {
  if (client === "codex") return "user"; // Codex has no per-project MCP config
  const result = await p.select<"user" | "project">({
    message: `Scope for ${client === "cursor" ? "Cursor" : "Claude Code"}:`,
    options: [
      {
        value: "user",
        label: "User (applies everywhere)",
        hint: client === "cursor" ? "~/.cursor/mcp.json" : "claude mcp add --scope user",
      },
      {
        value: "project",
        label: "Project (this repo only)",
        hint: client === "cursor" ? "./.cursor/mcp.json" : "claude mcp add --scope project",
      },
    ],
    initialValue: "user",
  });
  if (p.isCancel(result)) {
    p.cancel("aborted");
    process.exit(130);
  }
  return result;
}

async function pickSource(allowLocal: boolean): Promise<SourceId> {
  const options: Array<{ value: SourceId; label: string; hint: string }> = [
    { value: "npx", label: "npx (published, recommended)", hint: "uses latest npm release" },
  ];
  if (allowLocal) {
    options.push({ value: "local", label: "Local checkout", hint: "node <repo>/dist/bin/mcp.js" });
  }
  options.push({ value: "global", label: "Global install", hint: "expects `browser-agent-mcp` on PATH" });
  const result = await p.select<SourceId>({
    message: "How should clients launch browser-agent-mcp?",
    options,
    initialValue: "npx",
  });
  if (p.isCancel(result)) {
    p.cancel("aborted");
    process.exit(130);
  }
  return result;
}

function applyOne(choice: ClientChoice, name: string, cmd: ResolvedCommand): InstallResult {
  try {
    if (choice.id === "codex") {
      const r = installCodex({ name, command: cmd });
      return { client: "codex", ok: true, message: `${r.action} [mcp_servers.${name}] in ${r.path}` };
    }
    if (choice.id === "cursor") {
      const r = installCursor({ name, command: cmd, scope: choice.scope as CursorScope });
      return { client: "cursor", ok: true, message: `${r.action} mcpServers.${name} in ${r.path}` };
    }
    const r = installClaudeCode({ name, command: cmd, scope: choice.scope as ClaudeScope });
    return { client: "claude-code", ok: true, message: `ran: ${r.invocation}` };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { client: choice.id, ok: false, message: msg };
  }
}

export async function runInstall(opts: InstallOptions): Promise<InstallResult[]> {
  const name = opts.name ?? DEFAULT_SERVER_NAME;
  const detected = detectClients();
  const cliRoot = findLocalCheckout();
  const allowLocal = Boolean(cliRoot);

  let clientIds: ClientId[];
  if (opts.clients && opts.clients.length > 0) {
    clientIds = opts.clients;
  } else if (opts.allDetected) {
    clientIds = detected.filter((d) => d.detected).map((d) => d.id);
  } else if (opts.interactive ?? process.stdout.isTTY) {
    p.intro("browser-agent install");
    clientIds = await pickClients(detected);
  } else {
    throw new Error(
      "Non-interactive: pass --client <id>[,<id>...] or --all-detected. Try --help.",
    );
  }
  if (clientIds.length === 0) throw new Error("No clients selected.");

  const sourceId: SourceId =
    opts.source ??
    ((opts.interactive ?? process.stdout.isTTY) && !opts.print
      ? await pickSource(allowLocal)
      : "npx");
  const cmd = resolveSource(sourceId, cliRoot);

  const choices: ClientChoice[] = [];
  for (const id of clientIds) {
    const scope =
      opts.scope ??
      ((opts.interactive ?? process.stdout.isTTY) && !opts.print ? await pickScope(id) : "user");
    choices.push({ id, scope });
  }

  if (opts.print) {
    printSnippets(name, choices, cmd);
    return choices.map((c) => ({ client: c.id, ok: true, message: "(printed only)" }));
  }

  const results = choices.map((c) => applyOne(c, name, cmd));
  for (const r of results) {
    const tag = r.ok ? "✔" : "✗";
    const where =
      r.client === "codex" ? "Codex     " : r.client === "cursor" ? "Cursor    " : "Claude    ";
    console.log(`${tag} ${where} → ${r.message}`);
  }
  if (results.some((r) => r.ok)) {
    console.log("\nRestart each client to pick up the new server.");
  }
  return results;
}

export { resolveCursorPath };
