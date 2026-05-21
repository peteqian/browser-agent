import { describe, expect, test } from "bun:test";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodTypeAny } from "zod";

import { registerDaemonTools } from "./daemon";

describe("registerDaemonTools", () => {
  test("registers daemon session discovery tools", () => {
    const tools = registerToolsForTest();

    expect(tools.has("daemon_status")).toBe(true);
    expect(tools.has("daemon_list_sessions")).toBe(true);
    expect(tools.has("daemon_attach_session")).toBe(true);
  });

  test("registers daemon launch with the same persistence inputs as launch_session", () => {
    const tools = registerToolsForTest();

    const launch = tools.get("daemon_launch_session");
    expect(launch).toBeDefined();
    expect(launch?.inputSchema?.profile?.parse("booking")).toBe("booking");
    expect(launch?.inputSchema?.startUrl?.parse("about:blank")).toBe("about:blank");
    expect(launch?.inputSchema?.userDataDir?.parse("/tmp/profile")).toBe("/tmp/profile");
    expect(launch?.inputSchema?.storageStatePath?.parse("/tmp/state.json")).toBe("/tmp/state.json");
    expect(launch?.inputSchema?.channel?.parse("lightpanda")).toBe("lightpanda");
  });
});

function registerToolsForTest(): Map<string, ToolConfig> {
  const tools = new Map<string, ToolConfig>();
  const server = {
    registerTool(name: string, config: ToolConfig) {
      tools.set(name, config);
    },
  } as unknown as McpServer;
  registerDaemonTools(server);
  return tools;
}

interface ToolConfig {
  description?: string;
  inputSchema?: Record<string, ZodTypeAny>;
}
