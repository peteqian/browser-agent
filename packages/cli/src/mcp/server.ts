import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { PACKAGE_NAME, VERSION } from "../version";

import { registerAgentTool } from "./tools/agent";
import { registerExtractionTools } from "./tools/extraction";
import { registerInteractionTools } from "./tools/interaction";
import { registerNavigationTools } from "./tools/navigation";
import { registerSessionTools } from "./tools/session";
import { registerSkillTools } from "./tools/skills";
import { shutdownAllSessions } from "./sessions";

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
  registerSkillTools(server);
  return server;
}

export interface RunStdioServerHandle {
  /** Resolves once the transport closes (client disconnect or stdin EOF). */
  readonly closed: Promise<void>;
  /** Force-close the transport and dispose any live browser sessions. */
  dispose: () => Promise<void>;
}

export async function runStdioServer(): Promise<RunStdioServerHandle> {
  const server = createServer();
  const transport = new StdioServerTransport();

  let disposed = false;
  let resolveClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    resolveClosed = resolve;
  });

  const dispose = async (): Promise<void> => {
    if (disposed) return;
    disposed = true;
    try {
      await transport.close();
    } catch {
      // transport may already be closed
    }
    await shutdownAllSessions();
    resolveClosed();
  };

  transport.onclose = () => {
    void dispose();
  };

  await server.connect(transport);
  return { closed, dispose };
}
