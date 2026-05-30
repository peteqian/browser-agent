import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildClaudeArgs } from "./clients/claude-code";
import { installCodex, renderBlock } from "./clients/codex";
import { installCursor } from "./clients/cursor";
import { NPX_COMMAND } from "./snippet";

function freshTmp(): string {
  return mkdtempSync(join(tmpdir(), "ba-install-"));
}

describe("codex install", () => {
  test("appends mcp_servers block when file missing", () => {
    const dir = freshTmp();
    const path = join(dir, "config.toml");
    const r = installCodex({ name: "browser-agent", command: NPX_COMMAND, configPath: path });
    expect(r.action).toBe("added");
    const content = readFileSync(path, "utf8");
    expect(content).toContain("[mcp_servers.browser-agent]");
    expect(content).toContain(`command = "npx"`);
    expect(content).toContain("startup_timeout_sec = 20");
  });

  test("preserves other servers and replaces existing entry", () => {
    const dir = freshTmp();
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      [
        "[mcp_servers.chrome-devtools]",
        'command = "chrome-devtools-mcp"',
        "",
        "[mcp_servers.browser-agent]",
        'command = "old"',
        'args = ["old"]',
        "",
        "[other.section]",
        "key = 1",
        "",
      ].join("\n"),
    );
    const r = installCodex({ name: "browser-agent", command: NPX_COMMAND, configPath: path });
    expect(r.action).toBe("replaced");
    const content = readFileSync(path, "utf8");
    expect(content).toContain("[mcp_servers.chrome-devtools]");
    expect(content).toContain("[other.section]");
    expect(content).toContain(`command = "npx"`);
    expect(content).not.toContain(`command = "old"`);
  });

  test("ignores comments that mention the header", () => {
    const dir = freshTmp();
    const path = join(dir, "config.toml");
    writeFileSync(
      path,
      [
        "# see [mcp_servers.browser-agent] for the canonical example",
        "[mcp_servers.other]",
        'command = "x"',
        "",
      ].join("\n"),
    );
    const r = installCodex({ name: "browser-agent", command: NPX_COMMAND, configPath: path });
    expect(r.action).toBe("added");
    const content = readFileSync(path, "utf8");
    expect(content).toContain("# see [mcp_servers.browser-agent] for the canonical example");
    expect(content).toContain("[mcp_servers.other]");
    expect(content).toContain(`command = "npx"`);
  });

  test("renderBlock formats args as TOML array", () => {
    const block = renderBlock({ name: "x", command: NPX_COMMAND });
    expect(block).toContain(`args = ["-y", "-p", "@peteqian/browser-agent", "browser-agent-mcp"]`);
  });
});

describe("cursor install", () => {
  test("creates mcp.json when missing", () => {
    const dir = freshTmp();
    const path = join(dir, "mcp.json");
    const r = installCursor({ name: "browser-agent", command: NPX_COMMAND, configPath: path });
    expect(r.action).toBe("added");
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(parsed.mcpServers["browser-agent"].command).toBe("npx");
  });

  test("preserves existing servers", () => {
    const dir = freshTmp();
    const path = join(dir, "mcp.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { existing: { command: "x", args: [] } } }));
    installCursor({ name: "browser-agent", command: NPX_COMMAND, configPath: path });
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(parsed.mcpServers.existing.command).toBe("x");
    expect(parsed.mcpServers["browser-agent"].command).toBe("npx");
  });
});

describe("cursor malformed json", () => {
  test("refuses to overwrite invalid JSON", () => {
    const dir = freshTmp();
    const path = join(dir, "mcp.json");
    writeFileSync(path, "{ this is not json");
    expect(() => installCursor({ name: "x", command: NPX_COMMAND, configPath: path })).toThrow(
      /not valid JSON/,
    );
    // file must be untouched
    expect(readFileSync(path, "utf8")).toBe("{ this is not json");
  });
});

describe("claude-code args", () => {
  test("includes --scope and -- separator", () => {
    const args = buildClaudeArgs({ name: "browser-agent", command: NPX_COMMAND, scope: "project" });
    expect(args).toEqual([
      "mcp",
      "add",
      "--scope",
      "project",
      "browser-agent",
      "--",
      "npx",
      "-y",
      "-p",
      "@peteqian/browser-agent",
      "browser-agent-mcp",
    ]);
  });
});
