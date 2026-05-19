// The universe of MCP tools an agent can pick from.
// Harvested from packages/cli/src/mcp/tools/*.ts.
export interface ToolSpec {
  name: string;
  description: string;
}

export const TOOL_CATALOG: readonly ToolSpec[] = [
  // session.ts
  { name: "launch_session", description: "Launch a Chromium session. Returns sessionId." },
  { name: "new_tab", description: "Open a new tab and optionally navigate to URL." },
  { name: "list_tabs", description: "List open tab target IDs and active target ID." },
  { name: "switch_tab", description: "Switch active tab by targetId or pageId." },
  { name: "close_tab", description: "Close tab by targetId, pageId, or active tab." },
  { name: "close_session", description: "Close a Chromium session." },
  { name: "close_browser", description: "Close the browser session." },
  { name: "list_artifacts", description: "List saved artifacts (screenshots, PDFs)." },
  // navigation.ts
  { name: "navigate", description: "Navigate to a URL." },
  { name: "go_back", description: "Navigate back in browser history." },
  { name: "go_forward", description: "Navigate forward in browser history." },
  { name: "refresh", description: "Refresh current page." },
  // interaction.ts
  { name: "click", description: "Click element by [index] or by viewport coordinates." },
  { name: "type", description: "Type text into element [index]. Optionally submit." },
  { name: "send_keys", description: "Send keyboard key(s) to active element." },
  { name: "scroll", description: "Scroll the page up/down/top/bottom." },
  { name: "select_option", description: "Select option on dropdown element by label or value." },
  { name: "upload_file", description: "Upload local file path(s) to input element." },
  { name: "wait_for_text", description: "Wait for text to appear on current page." },
  { name: "wait", description: "Sleep for the given number of milliseconds." },
  // extraction.ts
  {
    name: "get_snapshot",
    description: "Formatted observation of page: URL, title, indexed interactive elements.",
  },
  { name: "search_page", description: "Search page text with literal/regex pattern and context." },
  { name: "find_elements", description: "Find elements by CSS selector." },
  { name: "find_text", description: "Scroll to first visible occurrence of text." },
  { name: "get_dropdown_options", description: "Get dropdown options from select element." },
  {
    name: "extract_content",
    description: "Extract page content chunk for a query, optional links/images.",
  },
  { name: "screenshot", description: "Capture page screenshot (base64 PNG) or save to file." },
  { name: "save_as_pdf", description: "Save current page as PDF file." },
  // agent.ts
  {
    name: "run_agent",
    description: "Run an autonomous browser agent loop end-to-end against a fresh session.",
  },
];

export const TOOL_NAMES: readonly string[] = TOOL_CATALOG.map((t) => t.name);

export function formatCatalog(): string {
  return TOOL_CATALOG.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}
