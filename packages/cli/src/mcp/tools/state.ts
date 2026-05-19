import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import {
  cleanAllStates,
  clearState,
  listStates,
  loadState,
  renameState,
  saveState,
  showState,
} from "@peteqian/browser-agent-sdk";

import { jsonResult } from "../helpers";
import { getSession } from "../sessions";

export function registerStateTools(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;

  registerTool(
    "save_state",
    {
      description:
        "Capture cookies + localStorage from the active page of a session and save under <name> in the vault.",
      inputSchema: { sessionId: z.string(), name: z.string() },
    },
    async ({ sessionId, name }) => {
      const record = getSession(sessionId);
      const summary = await saveState(name, record.page);
      return jsonResult(summary);
    },
  );

  registerTool(
    "load_state",
    {
      description:
        "Load a saved state from the vault. When applyTo is provided, writes it to that path so subsequent launches pick it up.",
      inputSchema: {
        sessionId: z.string(),
        name: z.string(),
        applyTo: z.string().optional(),
      },
    },
    async ({ sessionId, name, applyTo }) => {
      // sessionId is required by the tool contract for consistency, but loading
      // is filesystem-only: the saved state lands at applyTo (or remains in the
      // vault) and is consumed by a future BrowserSession.launch.
      getSession(sessionId);
      const state = await loadState(name);
      if (applyTo) {
        const { writeStorageStateFile } = await import(
          "@peteqian/browser-agent-sdk/internal"
        );
        await writeStorageStateFile(applyTo, state);
      }
      const summary = await showState(name);
      return jsonResult({ ...summary, appliedTo: applyTo ?? null });
    },
  );

  registerTool(
    "list_states",
    {
      description: "List all states saved in the vault.",
      inputSchema: {},
    },
    async () => {
      const items = await listStates();
      return jsonResult({ states: items });
    },
  );

  registerTool(
    "show_state",
    {
      description: "Show metadata for a saved state (counts, size, mtime). Does not leak secrets.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      const summary = await showState(name);
      return jsonResult(summary);
    },
  );

  registerTool(
    "rename_state",
    {
      description: "Rename a saved state.",
      inputSchema: { oldName: z.string(), newName: z.string() },
    },
    async ({ oldName, newName }) => {
      const result = await renameState(oldName, newName);
      return jsonResult(result);
    },
  );

  registerTool(
    "clear_state",
    {
      description: "Delete a single saved state.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      const result = await clearState(name);
      return jsonResult(result);
    },
  );

  registerTool(
    "clean_states",
    {
      description: "Delete every state in the vault.",
      inputSchema: {},
    },
    async () => {
      const result = await cleanAllStates();
      return jsonResult(result);
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
