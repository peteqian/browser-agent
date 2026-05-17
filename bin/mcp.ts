#!/usr/bin/env node
import { runStdioServer, shutdownAllSessions } from "../src/mcp/server";

const SHUTDOWN_HARD_DEADLINE_MS = Number(process.env.MCP_SHUTDOWN_DEADLINE_MS ?? 5000);

const handle = await runStdioServer();

let exiting = false;
async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (exiting) return;
  exiting = true;
  const hardKill = setTimeout(() => {
    console.error(`browser-agent-mcp: hard exit after ${SHUTDOWN_HARD_DEADLINE_MS}ms (${reason})`);
    process.exit(exitCode);
  }, SHUTDOWN_HARD_DEADLINE_MS);
  hardKill.unref?.();
  try {
    await handle.dispose();
  } catch (error) {
    console.error(`browser-agent-mcp: shutdown error (${reason}):`, error);
  } finally {
    clearTimeout(hardKill);
    process.exit(exitCode);
  }
}

process.once("SIGINT", () => void shutdown("SIGINT", 130));
process.once("SIGTERM", () => void shutdown("SIGTERM", 143));
process.once("SIGHUP", () => void shutdown("SIGHUP", 129));

process.on("uncaughtException", (error) => {
  console.error("browser-agent-mcp: uncaughtException", error);
  void shutdownAllSessions().finally(() => process.exit(1));
});
process.on("unhandledRejection", (reason) => {
  console.error("browser-agent-mcp: unhandledRejection", reason);
  void shutdownAllSessions().finally(() => process.exit(1));
});

await handle.closed;
await shutdown("transport_closed", 0);
