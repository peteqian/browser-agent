import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { PACKAGE_NAME, VERSION } from "../version";
import { registerAgentTool } from "./tools/agent";
import { registerExtractionTools } from "./tools/extraction";
import { registerInteractionTools } from "./tools/interaction";
import { registerNavigationTools } from "./tools/navigation";
import { registerSessionTools } from "./tools/session";

export {
  recordArtifact,
  shutdownAllSessions,
  sweepIdleSessions,
  type ArtifactKind,
  type SessionArtifact,
} from "./sessions";
export { buildProgressForwarder } from "./helpers";

export function createServer(): McpServer {
  const server = new McpServer({ name: PACKAGE_NAME, version: VERSION });
  registerSessionTools(server);
  registerNavigationTools(server);
  registerInteractionTools(server);
  registerExtractionTools(server);
  registerAgentTool(server);
  return server;
}

export async function runStdioServer(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
