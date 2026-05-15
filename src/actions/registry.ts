import type { z } from "zod";

import { executeAction, type ActionResult } from "./execute";
import { actionSchemas, type Action, type ActionName } from "./types";
import type { BrowserSession, Page } from "../browser/session";
import type { SelectorMap } from "../dom/cdp-snapshot";

export interface RegisteredAction {
  name: string;
  params: unknown;
}

export interface ActionContext {
  page: Page;
  session?: BrowserSession;
  signal?: AbortSignal;
  selectorMap?: SelectorMap;
  sensitiveData?: Record<string, string>;
}

export interface ActionDefinition<TName extends string = string, TParams = unknown> {
  name: TName;
  description: string;
  schema: z.ZodType<TParams>;
  run: (params: TParams, context: ActionContext) => Promise<ActionResult>;
}

export class ActionRegistry {
  private definitions = new Map<string, ActionDefinition>();

  register(definition: ActionDefinition): void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Action already registered: ${definition.name}`);
    }
    this.definitions.set(definition.name, definition);
  }

  parse(name: string, input: unknown): RegisteredAction | null {
    const definition = this.definitions.get(name);
    if (!definition) return null;

    const parsed = definition.schema.safeParse(input);
    if (!parsed.success) return null;

    return { name, params: parsed.data };
  }

  async execute(action: RegisteredAction, context: ActionContext): Promise<ActionResult> {
    const definition = this.definitions.get(action.name);
    if (!definition) {
      return {
        ok: false,
        message: `Unknown action: ${action.name}`,
        extractedContent: `Unknown action: ${action.name}`,
      };
    }

    return definition.run(action.params, context);
  }

  list(): ActionDefinition[] {
    return Array.from(this.definitions.values());
  }

  describeForPrompt(): string {
    return this.list()
      .map((definition) => `- ${definition.name}: ${definition.description}`)
      .join("\n");
  }
}

export function createActionRegistry(definitions: ActionDefinition[] = []): ActionRegistry {
  const registry = new ActionRegistry();
  for (const definition of definitions) {
    registry.register(definition);
  }
  return registry;
}

export function createDefaultActionRegistry(): ActionRegistry {
  return createActionRegistry(createDefaultActions());
}

export function createDefaultActions(): ActionDefinition[] {
  return Object.entries(actionSchemas).map(([name, schema]) => ({
    name,
    description: defaultActionDescription(name as ActionName),
    schema,
    run: async (params, context) =>
      executeAction(
        context.page,
        { name, params } as Action,
        context.session,
        context.signal,
        context.selectorMap,
        context.sensitiveData,
      ),
  }));
}

function defaultActionDescription(name: ActionName): string {
  switch (name) {
    case "navigate":
      return "Load a URL in the current tab or a new tab.";
    case "click":
      return "Click an indexed element or viewport coordinates.";
    case "type":
      return "Type text into an indexed input element.";
    case "scroll":
      return "Scroll the page or indexed scrollable element.";
    case "wait":
      return "Wait for dynamic page content.";
    case "send_keys":
      return "Send keyboard keys to the active element.";
    case "select_option":
      return "Choose a dropdown option by value or label.";
    case "upload_file":
      return "Upload local file paths to a file input.";
    case "wait_for_text":
      return "Wait until page text appears.";
    case "go_back":
      return "Navigate browser history back.";
    case "go_forward":
      return "Navigate browser history forward.";
    case "refresh":
      return "Refresh the active page.";
    case "new_tab":
      return "Open a new tab and optionally navigate.";
    case "switch_tab":
      return "Switch active tab by targetId or pageId.";
    case "close_tab":
      return "Close a tab.";
    case "close_browser":
      return "Close the browser session.";
    case "search_page":
      return "Search visible page text.";
    case "find_elements":
      return "Query elements by CSS selector.";
    case "get_dropdown_options":
      return "List options for an indexed select element.";
    case "find_text":
      return "Scroll to matching text.";
    case "screenshot":
      return "Capture a PNG screenshot.";
    case "save_as_pdf":
      return "Save the current page as PDF.";
    case "extract_content":
      return "Extract page content with optional links/images.";
    case "done":
      return "End the task with success/failure and optional data.";
  }
}
