import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { executeAction } from "../../actions/execute";
import { formatSnapshotForLLM, serializePage } from "../../dom/serialize";
import { jsonResult, textResult } from "../helpers";
import { getSession, recordArtifact } from "../sessions";

export function registerExtractionTools(server: McpServer): void {
  server.registerTool(
    "get_snapshot",
    {
      description:
        "Return a formatted observation of the page: URL, title, and indexed interactive elements.",
      inputSchema: z.object({ sessionId: z.string() }),
    },
    async ({ sessionId }) => {
      const { page } = getSession(sessionId);
      const { snapshot } = await serializePage(page);
      return textResult(formatSnapshotForLLM(snapshot));
    },
  );

  server.registerTool(
    "search_page",
    {
      description: "Search page text with literal/regex pattern and context.",
      inputSchema: z.object({
        sessionId: z.string(),
        pattern: z.string().min(1),
        regex: z.boolean().optional(),
        caseSensitive: z.boolean().optional(),
        contextChars: z.number().int().positive().max(1000).optional(),
        cssScope: z.string().optional(),
        maxResults: z.number().int().positive().max(200).optional(),
      }),
    },
    async ({ sessionId, pattern, regex, caseSensitive, contextChars, cssScope, maxResults }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "search_page",
          params: { pattern, regex, caseSensitive, contextChars, cssScope, maxResults },
        }),
      );
    },
  );

  server.registerTool(
    "find_elements",
    {
      description: "Find elements by CSS selector.",
      inputSchema: z.object({
        sessionId: z.string(),
        selector: z.string().min(1),
        attributes: z.array(z.string().min(1)).optional(),
        maxResults: z.number().int().positive().max(200).optional(),
        includeText: z.boolean().optional(),
      }),
    },
    async ({ sessionId, selector, attributes, maxResults, includeText }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "find_elements",
          params: { selector, attributes, maxResults, includeText },
        }),
      );
    },
  );

  server.registerTool(
    "get_dropdown_options",
    {
      description: "Get dropdown options from select element [index].",
      inputSchema: z.object({
        sessionId: z.string(),
        index: z.number().int().nonnegative(),
      }),
    },
    async ({ sessionId, index }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, { name: "get_dropdown_options", params: { index } }),
      );
    },
  );

  server.registerTool(
    "screenshot",
    {
      description: "Capture a page screenshot (base64 PNG) or save to file.",
      inputSchema: z.object({ sessionId: z.string(), fileName: z.string().optional() }),
    },
    async ({ sessionId, fileName }) => {
      const record = getSession(sessionId);
      const result = await executeAction(record.page, {
        name: "screenshot",
        params: { fileName },
      });
      recordArtifact(record, "screenshot", result);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "find_text",
    {
      description: "Scroll to first visible occurrence of text.",
      inputSchema: z.object({ sessionId: z.string(), text: z.string().min(1) }),
    },
    async ({ sessionId, text }) => {
      const { page } = getSession(sessionId);
      return jsonResult(await executeAction(page, { name: "find_text", params: { text } }));
    },
  );

  server.registerTool(
    "save_as_pdf",
    {
      description: "Save current page as PDF file.",
      inputSchema: z.object({
        sessionId: z.string(),
        fileName: z.string().optional(),
        printBackground: z.boolean().optional(),
        landscape: z.boolean().optional(),
        scale: z.number().min(0.1).max(2).optional(),
        paperFormat: z.enum(["Letter", "Legal", "A4", "A3", "Tabloid"]).optional(),
      }),
    },
    async ({ sessionId, fileName, printBackground, landscape, scale, paperFormat }) => {
      const record = getSession(sessionId);
      const result = await executeAction(record.page, {
        name: "save_as_pdf",
        params: { fileName, printBackground, landscape, scale, paperFormat },
      });
      recordArtifact(record, "pdf", result);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "extract_content",
    {
      description: "Extract page content chunk for a query with optional links/images.",
      inputSchema: z.object({
        sessionId: z.string(),
        query: z.string().min(1),
        extractLinks: z.boolean().optional(),
        extractImages: z.boolean().optional(),
        startFromChar: z.number().int().nonnegative().optional(),
        maxChars: z.number().int().positive().max(200_000).optional(),
      }),
    },
    async ({ sessionId, query, extractLinks, extractImages, startFromChar, maxChars }) => {
      const { page } = getSession(sessionId);
      return jsonResult(
        await executeAction(page, {
          name: "extract_content",
          params: { query, extractLinks, extractImages, startFromChar, maxChars },
        }),
      );
    },
  );
}
