import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { executeAction, formatSnapshotForLLM } from "@peteqian/browser-agent-sdk/internal";
import {
  indexFromRef,
  jsonResult,
  refreshSessionState,
  runSessionAction,
  textResult,
} from "../helpers";
import { getSession, recordArtifact } from "../sessions";

const elementRef = z.string().regex(/^@?e\d+$/, "Use @eN from the latest observation.");

export function registerExtractionTools(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;
  registerTool(
    "get_snapshot",
    {
      description:
        "Return a formatted observation of the page: URL, title, and indexed interactive elements.",
      inputSchema: { sessionId: z.string() },
    },
    async ({ sessionId }) => {
      const record = getSession(sessionId);
      const state = await refreshSessionState(record);
      return textResult(
        formatSnapshotForLLM(state.snapshot, { maxDisplayElements: 100, maxTotalChars: 12_000 }),
      );
    },
  );

  registerTool(
    "search_page",
    {
      description: "Search page text with literal/regex pattern and context.",
      inputSchema: {
        sessionId: z.string(),
        pattern: z.string().min(1),
        regex: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        contextChars: z.number().int().positive().max(1000).optional(),
        cssScope: z.string().optional(),
        maxResults: z.number().int().positive().max(200).optional(),
      },
    },
    async ({ sessionId, pattern, regex, caseSensitive, contextChars, cssScope, maxResults }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "search_page",
        params: { pattern, regex, caseSensitive, contextChars, cssScope, maxResults },
      });
    },
  );

  registerTool(
    "find_elements",
    {
      description: "Find elements by CSS selector.",
      inputSchema: {
        sessionId: z.string(),
        selector: z.string().min(1),
        attributes: z.array(z.string().min(1)).optional(),
        maxResults: z.number().int().positive().max(200).optional(),
        includeText: z.boolean().optional(),
      },
    },
    async ({ sessionId, selector, attributes, maxResults, includeText }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "find_elements",
        params: { selector, attributes, maxResults, includeText },
      });
    },
  );

  registerTool(
    "get_dropdown_options",
    {
      description: "Get dropdown options from select element [index].",
      inputSchema: {
        sessionId: z.string(),
        index: z.number().int().nonnegative().optional(),
        ref: elementRef.optional(),
      },
    },
    async ({ sessionId, index, ref }) => {
      const resolved = indexFromRef({ index, ref });
      if (typeof resolved !== "number") throw new Error("Provide index or ref, e.g. @e4.");
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "get_dropdown_options",
        params: { index: resolved },
      });
    },
  );

  registerTool(
    "screenshot",
    {
      description: "Capture a page screenshot (base64 PNG) or save to file.",
      inputSchema: { sessionId: z.string(), fileName: z.string().optional() },
    },
    async ({ sessionId, fileName }) => {
      const record = getSession(sessionId);
      const result = await executeAction(
        record.page,
        {
          name: "screenshot",
          params: { fileName },
        },
        record.session,
        undefined,
        record.latestState?.selectorMap,
        undefined,
        undefined,
        undefined,
        {
          snapshotElements: record.latestState?.elements,
        },
      );
      recordArtifact(record, "screenshot", result);
      return jsonResult(result);
    },
  );

  registerTool(
    "find_text",
    {
      description: "Scroll to first visible occurrence of text.",
      inputSchema: { sessionId: z.string(), text: z.string().min(1) },
    },
    async ({ sessionId, text }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "find_text", params: { text } });
    },
  );

  registerTool(
    "save_as_pdf",
    {
      description: "Save current page as PDF file.",
      inputSchema: {
        sessionId: z.string(),
        fileName: z.string().optional(),
        printBackground: z.boolean().optional(),
        landscape: z.boolean().optional(),
        scale: z.number().min(0.1).max(2).optional(),
        paperFormat: z.enum(["Letter", "Legal", "A4", "A3", "Tabloid"]).optional(),
      },
    },
    async ({ sessionId, fileName, printBackground, landscape, scale, paperFormat }) => {
      const record = getSession(sessionId);
      const result = await executeAction(
        record.page,
        {
          name: "save_as_pdf",
          params: { fileName, printBackground, landscape, scale, paperFormat },
        },
        record.session,
        undefined,
        record.latestState?.selectorMap,
        undefined,
        undefined,
        undefined,
        {
          snapshotElements: record.latestState?.elements,
        },
      );
      recordArtifact(record, "pdf", result);
      return jsonResult(result);
    },
  );

  registerTool(
    "eval",
    {
      description:
        "Evaluate a JavaScript expression in the page and return the JSON-serialized result.",
      inputSchema: {
        sessionId: z.string(),
        expression: z.string().min(1).max(20_000),
      },
    },
    async ({ sessionId, expression }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, { name: "eval", params: { expression } });
    },
  );

  registerTool(
    "extract_content",
    {
      description: "Extract page content chunk for a query with optional links/images.",
      inputSchema: {
        sessionId: z.string(),
        query: z.string().min(1),
        extractLinks: z.boolean().optional(),
        extractImages: z.boolean().optional(),
        schemaJson: z.string().max(8_000).optional(),
      },
    },
    async ({ sessionId, query, extractLinks, extractImages, schemaJson }) => {
      const record = getSession(sessionId);
      return runSessionAction(record, {
        name: "extract_content",
        params: {
          query,
          extractLinks,
          extractImages,
          schemaJson,
        },
      });
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
