/**
 * MCP server example.
 *
 * Spawns the browser-agent stdio MCP server via the package's `bin/mcp.ts`
 * entry point and exercises it with a real MCP client over stdio. Walks
 * through the full session lifecycle: launch_session -> navigate ->
 * get_snapshot -> screenshot -> list_artifacts -> close_session.
 *
 * Run:
 *   bun --cwd packages/cli run example:mcp
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const tmp = mkdtempSync(join(tmpdir(), "browser-agent-mcp-example-"));

const transport = new StdioClientTransport({
  command: "bun",
  args: ["run", "bin/mcp.ts"],
  env: process.env as Record<string, string>,
});

const client = new Client({ name: "mcp-example", version: "0.0.0" });
await client.connect(transport);

try {
  const tools = await client.listTools();
  console.log(
    "tools:",
    tools.tools
      .map((t) => t.name)
      .toSorted()
      .join(", "),
  );

  const launch = await client.callTool({
    name: "launch_session",
    arguments: { headless: true, startUrl: "https://example.com" },
  });
  const { sessionId } = JSON.parse(textOf(launch));
  console.log("sessionId:", sessionId);

  const snap = await client.callTool({
    name: "get_snapshot",
    arguments: { sessionId },
  });
  console.log("snapshot (first 200 chars):", textOf(snap).slice(0, 200));

  await client.callTool({
    name: "screenshot",
    arguments: { sessionId, fileName: join(tmp, "shot.png") },
  });

  const artifacts = await client.callTool({
    name: "list_artifacts",
    arguments: { sessionId },
  });
  console.log("artifacts:", textOf(artifacts));

  await client.callTool({ name: "close_session", arguments: { sessionId } });
} finally {
  await client.close();
  spawn("true");
  rmSync(tmp, { recursive: true, force: true });
}

function textOf(result: unknown): string {
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content ?? [];
  return content
    .filter((c) => c.type === "text")
    .map((c) => c.text ?? "")
    .join("");
}
