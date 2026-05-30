export const PKG_NAME = "@peteqian/browser-agent";
export const MCP_BIN = "browser-agent-mcp";
export const DEFAULT_SERVER_NAME = "browser-agent";

export type SourceId = "npx" | "local" | "global";

export interface ResolvedCommand {
  command: string;
  args: string[];
}

export const NPX_COMMAND: ResolvedCommand = {
  command: "npx",
  args: ["-y", "-p", PKG_NAME, MCP_BIN],
};

export const GLOBAL_COMMAND: ResolvedCommand = {
  command: MCP_BIN,
  args: [],
};
