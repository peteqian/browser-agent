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

  test("registers named daemon extraction tools", () => {
    const tools = registerToolsForTest();

    expect(tools.has("daemon_search_page")).toBe(true);
    expect(tools.has("daemon_find_elements")).toBe(true);
    expect(tools.has("daemon_get_dropdown_options")).toBe(true);
    expect(tools.has("daemon_find_text")).toBe(true);
    expect(tools.has("daemon_screenshot")).toBe(true);
    expect(tools.has("daemon_save_as_pdf")).toBe(true);
    expect(tools.has("daemon_extract_content")).toBe(true);
    expect(tools.has("daemon_list_artifacts")).toBe(true);
  });

  test("daemon extraction schemas match direct tool inputs", () => {
    const tools = registerToolsForTest();

    const screenshot = tools.get("daemon_screenshot");
    expect(screenshot?.inputSchema?.sessionId?.parse("sess_1")).toBe("sess_1");
    expect(screenshot?.inputSchema?.fileName?.parse("shot.png")).toBe("shot.png");
    expect(screenshot?.inputSchema?.annotate?.parse(true)).toBe(true);

    const pdf = tools.get("daemon_save_as_pdf");
    expect(pdf?.inputSchema?.paperFormat?.parse("A4")).toBe("A4");
    expect(pdf?.inputSchema?.scale?.parse(1.25)).toBe(1.25);

    const extract = tools.get("daemon_extract_content");
    expect(extract?.inputSchema?.query?.parse("pricing")).toBe("pricing");
    expect(extract?.inputSchema?.maxChars?.parse(2000)).toBe(2000);
    expect(extract?.inputSchema?.alreadyCollected?.parse(["https://example.com/a"])).toEqual([
      "https://example.com/a",
    ]);
    expect(extract?.inputSchema?.schemaJson?.parse('{"type":"object"}')).toBe('{"type":"object"}');

    const dropdown = tools.get("daemon_get_dropdown_options");
    expect(dropdown?.inputSchema?.ref?.parse("@e3")).toBe("@e3");

    const artifacts = tools.get("daemon_list_artifacts");
    expect(artifacts?.inputSchema?.kind?.parse("pdf")).toBe("pdf");
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
