import type { z } from "zod";

import { executeAction, type ActionResult } from "./execute";
import { actionSchemas, type Action, type ActionName } from "./types";
import type { BrowserSession, Page } from "../browser/session";
import type { BrowserStateSummary } from "../browser/state";
import type { SelectorMap } from "../dom/cdp-snapshot";
import type { ExtractionLLMFn } from "../agent/contracts";
import type { FocusState } from "../agent/focus-state";
import type { ElementInfo } from "../dom/types";

type AnyActionDefinition = ActionDefinition<string, any>;

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
  newTabDetectMs?: number;
  extractionLLM?: ExtractionLLMFn;
  focusState?: FocusState;
  snapshotElements?: readonly ElementInfo[];
  currentStep?: number;
  currentUrl?: string;
  allowedDomains?: readonly string[];
}

export interface ActionDefinition<TName extends string = string, TParams = unknown> {
  name: TName;
  description: string;
  schema: z.ZodType<TParams>;
  run: (params: TParams, context: ActionContext) => Promise<ActionResult>;
  /**
   * Optional predicate that decides whether the action should appear in
   * the prompt for the current browser state. Built-in actions omit this
   * (always available). Custom actions can scope themselves by URL or
   * tab count. The model never sees actions for which this returns
   * false; if it tries to invoke one anyway, schema parse rejects it.
   */
  appliesTo?: (state: BrowserStateSummary) => boolean;
}

export class ActionRegistry {
  private definitions = new Map<string, AnyActionDefinition>();

  register<TName extends string, TParams>(definition: ActionDefinition<TName, TParams>): void {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Action already registered: ${definition.name}`);
    }
    this.definitions.set(definition.name, definition as AnyActionDefinition);
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

  listFor(state: BrowserStateSummary): ActionDefinition[] {
    return this.list().filter((def) => !def.appliesTo || def.appliesTo(state));
  }

  describeForPrompt(state?: BrowserStateSummary): string {
    const defs = state ? this.listFor(state) : this.list();
    return defs.map((definition) => `- ${definition.name}: ${definition.description}`).join("\n");
  }
}

export function createActionRegistry(
  definitions: readonly AnyActionDefinition[] = [],
): ActionRegistry {
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
        context.newTabDetectMs,
        context.extractionLLM,
        {
          focusState: context.focusState,
          snapshotElements: context.snapshotElements,
          currentStep: context.currentStep,
          currentUrl: context.currentUrl,
          allowedDomains: context.allowedDomains,
        },
      ),
  }));
}

const ACTION_DESCRIPTIONS = {
  navigate: "Load a URL in the current tab or a new tab.",
  click:
    "(legacy) Click by numeric [index]. Prefer `click_by` with a stable locator; indices reshuffle between snapshots.",
  focus: "Focus an element by numeric [index] so later keyboard actions target it.",
  type: "(legacy) Type into a numeric [index] input using browser keyboard input. Prefer `type_by` with a stable locator.",
  fill: "Focus and replace text in an indexed input using browser keyboard input.",
  scroll: "Scroll the page or indexed scrollable element.",
  wait: "Wait for dynamic page content.",
  send_keys: "Send keyboard keys to the active element.",
  press: "Press one keyboard key or chord on the active element.",
  keyboard_type: "Type text into the currently focused element using browser keyboard input.",
  select_option: "(legacy) Choose a dropdown option on numeric [index]. Prefer `select_by`.",
  upload_file: "Upload local file paths to a file input.",
  wait_for_text: "Wait until page text appears.",
  wait_for_condition:
    "Poll a JS expression in the page until it becomes truthy (or timeoutMs elapses).",
  wait_for_url:
    "Wait until the current page URL matches the pattern (substring or wildcard with *).",
  go_back: "Navigate browser history back.",
  go_forward: "Navigate browser history forward.",
  refresh: "Refresh the active page.",
  new_tab: "Open a new tab and optionally navigate.",
  switch_tab: "Switch active tab by targetId or pageId.",
  close_tab: "Close a tab.",
  close_browser: "Close the browser session.",
  search_page: "Search visible page text.",
  find_elements: "Query elements by CSS selector.",
  get_dropdown_options: "List options for an indexed select element.",
  find_text: "Scroll to matching text.",
  screenshot: "Capture a PNG screenshot.",
  save_as_pdf: "Save the current page as PDF.",
  extract_content:
    "PREFERRED for reading page text/values. Returns clean markdown for the region matching `query` (e.g. 'top hotel name and price'). Use this instead of eval+CSS for any text/number/list extraction. Optional `extractLinks`, `extractImages`, `maxChars`, `alreadyCollected`.",
  focus_area:
    "Narrow future observations to a page region matching a natural-language query (e.g. 'search form'). Pass clear=true to drop focus.",
  click_by:
    "Click an element by semantic locator { testid? | role+name? | label? | placeholder? | href? | text? }. PREFERRED over `click [index]`. Fails with 'ambiguous' if >1 matches without `nth`.",
  type_by:
    "Type text into an input matched by semantic locator (same shape as click_by). PREFERRED over `type [index]`.",
  select_by:
    "Choose a dropdown option on a select matched by semantic locator. PREFERRED over `select_option [index]`.",
  hover: "Move the mouse over element [index].",
  dblclick: "Double-click element [index].",
  eval: "Evaluate a JavaScript expression. ONLY for computing values the DOM cannot tell you (window globals, framework state, page-side math). Do NOT use to scrape text or prices via CSS selectors — call `extract_content` instead. Result is sliced to 4000 chars.",
  find_by_role:
    "Return indices of snapshot elements matching ARIA role (and optional accessible name).",
  find_by_text:
    "Return indices of snapshot elements whose visible/accessible text contains the substring.",
  find_by_testid: "Return indices of snapshot elements with a matching data-testid.",
  dialog_handle: "Accept or dismiss a JavaScript dialog (alert/confirm/prompt/beforeunload).",
  network_har_start: "Start recording network requests on the current page.",
  network_har_stop: "Stop recording and return collected HAR-like JSON (or write to file).",
  network_list_requests:
    "List requests captured by the active HAR recorder, filtered by url substring/method/status. Requires network_har_start first.",
  set_viewport:
    "Override the device metrics (viewport width/height, optional deviceScaleFactor, optional mobile flag).",
  cookies_get: "Return browser cookies (optionally filter to a list of URLs).",
  cookies_set: "Set one or more browser cookies. Each entry needs url or domain.",
  cookies_clear: "Clear all browser cookies in the current session.",
  console_start:
    "Begin buffering console messages (log/info/warning/error/debug) and uncaught exceptions for the current page.",
  console_read:
    "Return buffered console entries. Optional level filter and maxResults; clear=true empties the buffer after read.",
  console_stop: "Stop console capture and return the count of buffered entries.",
  profiler_start:
    "Start a CDP performance trace on the current page. Pair with profiler_stop to capture a Chrome trace JSON.",
  profiler_stop:
    "Stop the active CDP performance trace and return (or write) Chrome Trace Event JSON.",
  done: "End the task with success/failure and optional data.",
} as const satisfies Record<ActionName, string>;

function defaultActionDescription(name: ActionName): string {
  return ACTION_DESCRIPTIONS[name];
}
