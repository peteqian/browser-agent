import { parseArgs } from "node:util";

import { runInstall, type InstallOptions } from "../install";
import type { ClientId } from "../install/detect";
import type { SourceId } from "../install/snippet";

const VALID_CLIENTS = new Set<ClientId>(["codex", "claude-code", "cursor"]);
const VALID_SOURCES = new Set<SourceId>(["npx", "local", "global"]);
const VALID_SCOPES = new Set(["user", "project"]);

export async function runInstallCommand(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      client: { type: "string" },
      scope: { type: "string" },
      source: { type: "string" },
      name: { type: "string" },
      print: { type: "boolean" },
      "all-detected": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`browser-agent install — configure MCP clients to launch browser-agent-mcp.

Usage:
  browser-agent install                              # interactive TUI
  browser-agent install --client codex,cursor        # non-interactive
  browser-agent install --all-detected               # write to every detected client
  browser-agent install --client codex --print       # print snippet only, no write

Flags:
  --client <ids>      Comma-separated: codex,claude-code,cursor
  --scope <s>         user | project (default: user; Codex ignores)
  --source <s>        npx (default) | local | global
  --name <n>          Server name (default: browser-agent)
  --print             Print config snippets to stdout, don't write
  --all-detected      Use detection to pick clients, no prompts
  --help, -h
`);
    return 0;
  }

  const opts: InstallOptions = {
    name: values.name as string | undefined,
    print: Boolean(values.print),
    allDetected: Boolean(values["all-detected"]),
  };

  if (values.client) {
    const ids = (values.client as string)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const id of ids) {
      if (!VALID_CLIENTS.has(id as ClientId)) {
        throw new Error(`--client must be one of: codex,claude-code,cursor. Got: ${id}`);
      }
    }
    opts.clients = ids as ClientId[];
  }
  if (values.scope) {
    if (!VALID_SCOPES.has(values.scope as string)) {
      throw new Error(`--scope must be user|project. Got: ${values.scope}`);
    }
    opts.scope = values.scope as "user" | "project";
  }
  if (values.source) {
    if (!VALID_SOURCES.has(values.source as SourceId)) {
      throw new Error(`--source must be npx|local|global. Got: ${values.source}`);
    }
    opts.source = values.source as SourceId;
  }

  const results = await runInstall(opts);
  return results.every((r) => r.ok) ? 0 : 1;
}
