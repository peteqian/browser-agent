import { z } from "zod";

export const navigateAction = z.object({
  url: z.string().url(),
  newTab: z.boolean().optional(),
});

export const clickAction = z
  .object({
    index: z.number().int().nonnegative().optional(),
    coordinateX: z.number().int().optional(),
    coordinateY: z.number().int().optional(),
  })
  .superRefine((value, ctx) => {
    const hasIndex = typeof value.index === "number";
    const hasCoordinates =
      typeof value.coordinateX === "number" && typeof value.coordinateY === "number";
    const oneCoordinateMissing =
      (typeof value.coordinateX === "number" && typeof value.coordinateY !== "number") ||
      (typeof value.coordinateY === "number" && typeof value.coordinateX !== "number");

    if (oneCoordinateMissing) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "click requires both coordinateX and coordinateY when using coordinates",
      });
      return;
    }

    if (!hasIndex && !hasCoordinates) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "click requires either index or both coordinateX and coordinateY",
      });
    }
  });

export const typeAction = z.object({
  index: z.number().int().nonnegative(),
  text: z.string(),
  submit: z.boolean().optional(),
  mode: z.enum(["replace", "append"]).default("replace"),
});

export const focusAction = z.object({
  index: z.number().int().nonnegative(),
});

export const fillAction = z.object({
  index: z.number().int().nonnegative(),
  text: z.string(),
  submit: z.boolean().optional(),
});

export const scrollAction = z.object({
  direction: z.enum(["up", "down", "top", "bottom"]),
  amount: z.number().int().positive().optional(),
  pages: z.number().positive().max(10).optional(),
  index: z.number().int().nonnegative().optional(),
});

export const waitAction = z.object({
  ms: z.number().int().positive().max(10_000),
});

export const sendKeysAction = z.object({
  keys: z.string().min(1),
});

export const pressAction = z.object({
  key: z.string().min(1),
});

export const keyboardTypeAction = z.object({
  text: z.string().min(1),
});

export const selectOptionAction = z.object({
  index: z.number().int().nonnegative(),
  value: z.string().min(1),
});

export const uploadFileAction = z.object({
  index: z.number().int().nonnegative(),
  paths: z.array(z.string().min(1)).min(1),
});

export const waitForTextAction = z.object({
  text: z.string().min(1),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
});

export const waitForConditionAction = z.object({
  expression: z.string().min(1).max(4_000),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
});

export const waitForUrlAction = z.object({
  /**
   * Substring or wildcard pattern. Use `*` for one-or-more wildcards
   * (e.g. `/dashboard*` or `https://*.example.com/*`). Bare substrings
   * are treated as a contains-check.
   */
  pattern: z.string().min(1).max(500),
  timeoutMs: z.number().int().positive().max(30_000).optional(),
});

export const setViewportAction = z.object({
  width: z.number().int().positive().max(8000),
  height: z.number().int().positive().max(8000),
  deviceScaleFactor: z.number().positive().max(5).optional(),
  mobile: z.boolean().optional(),
});

export const consoleStartAction = z.object({});

export const consoleReadAction = z.object({
  level: z.enum(["log", "info", "warning", "warn", "error", "debug", "exception"]).optional(),
  maxResults: z.number().int().positive().max(500).optional(),
  clear: z.boolean().optional(),
});

export const consoleStopAction = z.object({});

export const networkListRequestsAction = z.object({
  /** Substring match against the request URL (case-insensitive). */
  urlIncludes: z.string().min(1).max(500).optional(),
  /** HTTP method filter, e.g. "GET", "POST". */
  method: z.string().min(1).max(20).optional(),
  /** "2xx"/"3xx"/"4xx"/"5xx" or a specific status code. */
  status: z
    .union([z.number().int().min(100).max(599), z.enum(["1xx", "2xx", "3xx", "4xx", "5xx"])])
    .optional(),
  /** Cap the number of returned entries. Default 50, max 500. */
  maxResults: z.number().int().positive().max(500).optional(),
});

export const noParamsAction = z.object({});

export const newTabAction = z.object({
  url: z.string().url().optional(),
});

export const switchTabAction = z
  .object({
    targetId: z.string().min(1).optional(),
    pageId: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    const hasTargetId = typeof value.targetId === "string" && value.targetId.length > 0;
    const hasPageId = typeof value.pageId === "number";
    if (!hasTargetId && !hasPageId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "switch_tab requires targetId or pageId",
      });
    }
  });

export const closeTabAction = z.object({
  targetId: z.string().min(1).optional(),
  pageId: z.number().int().nonnegative().optional(),
});

export const searchPageAction = z.object({
  pattern: z.string().min(1),
  regex: z.boolean().optional(),
  caseSensitive: z.boolean().optional(),
  contextChars: z.number().int().positive().max(1000).optional(),
  cssScope: z.string().optional(),
  maxResults: z.number().int().positive().max(200).optional(),
});

export const findElementsAction = z.object({
  selector: z.string().min(1),
  attributes: z.array(z.string().min(1)).optional(),
  maxResults: z.number().int().positive().max(200).optional(),
  includeText: z.boolean().optional(),
});

export const getDropdownOptionsAction = z.object({
  index: z.number().int().nonnegative(),
});

export const findTextAction = z.object({
  text: z.string().min(1),
});

export const screenshotAction = z.object({
  fileName: z.string().min(1).optional(),
  annotate: z.boolean().optional(),
});

export const saveAsPdfAction = z.object({
  fileName: z.string().min(1).optional(),
  printBackground: z.boolean().optional(),
  landscape: z.boolean().optional(),
  scale: z.number().min(0.1).max(2).optional(),
  paperFormat: z.enum(["Letter", "Legal", "A4", "A3", "Tabloid"]).optional(),
});

export const extractContentAction = z.object({
  query: z.string().min(1),
  extractLinks: z.boolean().optional(),
  extractImages: z.boolean().optional(),
  startFromChar: z.number().int().nonnegative().optional(),
  maxChars: z.number().int().positive().max(200_000).optional(),
  /**
   * Identifiers (canonical URLs, item ids, hash keys) the agent has
   * already collected across prior extract calls. Used to dedupe links
   * across paginated extractions so the loop does not re-process the
   * same items.
   */
  alreadyCollected: z.array(z.string()).max(5_000).optional(),
  /**
   * Optional JSON Schema (as a string) describing the desired structured
   * output. When `AgentOptions.extractionLLM` is configured, the executor
   * routes the extracted markdown plus this schema through the hook and
   * exposes its result as `data.structured`. Ignored if no hook is wired.
   */
  schemaJson: z.string().max(8_000).optional(),
});

export const locatorSchema = z
  .object({
    role: z.string().min(1).max(40).optional(),
    name: z.string().min(1).max(200).optional(),
    text: z.string().min(1).max(200).optional(),
    testid: z.string().min(1).max(120).optional(),
    label: z.string().min(1).max(200).optional(),
    placeholder: z.string().min(1).max(200).optional(),
    href: z.string().min(1).max(400).optional(),
    /** Cross-snapshot stable identifier; reuse one from a previous observation when re-targeting the same conceptual element. */
    stableId: z
      .string()
      .regex(/^[0-9a-f]{8}$/)
      .optional(),
    dataAttr: z
      .object({
        key: z.string().min(1).max(60),
        value: z.string().min(1).max(200),
      })
      .optional(),
    nth: z.number().int().nonnegative().optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !value.role &&
      !value.text &&
      !value.testid &&
      !value.label &&
      !value.placeholder &&
      !value.href &&
      !value.stableId &&
      !value.dataAttr
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "locator requires at least one of: role, text, testid, label, placeholder, href, dataAttr",
      });
    }
    if (value.name && !value.role) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`name` is only meaningful when `role` is also set",
      });
    }
  });

export const clickByAction = z.object({
  locator: locatorSchema,
});

export const typeByAction = z.object({
  locator: locatorSchema,
  text: z.string(),
  submit: z.boolean().optional(),
  mode: z.enum(["replace", "append"]).default("replace"),
});

export const selectByAction = z.object({
  locator: locatorSchema,
  value: z.string().min(1),
});

export const focusAreaAction = z.object({
  query: z
    .string()
    .min(1)
    .max(200)
    .describe(
      "Natural-language description of the page region to focus on (e.g. 'search form', 'results list', 'sort dropdown'). Pass empty/'clear' to drop focus.",
    ),
  clear: z.boolean().optional(),
});

export const hoverAction = z.object({
  index: z.number().int().nonnegative(),
});

export const dblclickAction = z.object({
  index: z.number().int().nonnegative(),
});

export const evalAction = z.object({
  expression: z.string().min(1).max(20_000),
  awaitPromise: z.boolean().optional(),
});

export const findByRoleAction = z.object({
  role: z.string().min(1).max(40),
  name: z.string().min(1).max(200).optional(),
  /** When true, matches a substring of the accessible name. Default false (exact match, case-insensitive). */
  partial: z.boolean().optional(),
});

export const findByTextAction = z.object({
  text: z.string().min(2).max(200),
  /** When true, matches a substring. Default false (exact match, case-insensitive). */
  partial: z.boolean().optional(),
});

export const findByTestidAction = z.object({
  testid: z.string().min(1).max(120),
});

export const dialogHandleAction = z.object({
  accept: z.boolean(),
  promptText: z.string().optional(),
});

export const profilerStartAction = z.object({
  categories: z.array(z.string().min(1)).max(64).optional(),
});

export const profilerStopAction = z.object({
  fileName: z.string().min(1).optional(),
});

export const networkHarStartAction = z.object({});

export const networkHarStopAction = z.object({
  fileName: z.string().min(1).optional(),
});

export const doneAction = z.object({
  success: z.boolean(),
  summary: z.string(),
  data: z.unknown().optional(),
});

export const actionSchemas = {
  navigate: navigateAction,
  click: clickAction,
  focus: focusAction,
  type: typeAction,
  fill: fillAction,
  scroll: scrollAction,
  wait: waitAction,
  send_keys: sendKeysAction,
  press: pressAction,
  keyboard_type: keyboardTypeAction,
  select_option: selectOptionAction,
  upload_file: uploadFileAction,
  wait_for_text: waitForTextAction,
  wait_for_condition: waitForConditionAction,
  wait_for_url: waitForUrlAction,
  go_back: noParamsAction,
  go_forward: noParamsAction,
  refresh: noParamsAction,
  new_tab: newTabAction,
  switch_tab: switchTabAction,
  close_tab: closeTabAction,
  close_browser: noParamsAction,
  search_page: searchPageAction,
  find_elements: findElementsAction,
  get_dropdown_options: getDropdownOptionsAction,
  find_text: findTextAction,
  screenshot: screenshotAction,
  save_as_pdf: saveAsPdfAction,
  extract_content: extractContentAction,
  focus_area: focusAreaAction,
  click_by: clickByAction,
  type_by: typeByAction,
  select_by: selectByAction,
  hover: hoverAction,
  dblclick: dblclickAction,
  eval: evalAction,
  find_by_role: findByRoleAction,
  find_by_text: findByTextAction,
  find_by_testid: findByTestidAction,
  dialog_handle: dialogHandleAction,
  network_har_start: networkHarStartAction,
  network_har_stop: networkHarStopAction,
  network_list_requests: networkListRequestsAction,
  set_viewport: setViewportAction,
  console_start: consoleStartAction,
  console_read: consoleReadAction,
  console_stop: consoleStopAction,
  profiler_start: profilerStartAction,
  profiler_stop: profilerStopAction,
  done: doneAction,
} as const;

export type ActionName = keyof typeof actionSchemas;

export type Action =
  | { name: "navigate"; params: z.infer<typeof navigateAction> }
  | { name: "click"; params: z.infer<typeof clickAction> }
  | { name: "focus"; params: z.infer<typeof focusAction> }
  | { name: "type"; params: z.infer<typeof typeAction> }
  | { name: "fill"; params: z.infer<typeof fillAction> }
  | { name: "scroll"; params: z.infer<typeof scrollAction> }
  | { name: "wait"; params: z.infer<typeof waitAction> }
  | { name: "send_keys"; params: z.infer<typeof sendKeysAction> }
  | { name: "press"; params: z.infer<typeof pressAction> }
  | { name: "keyboard_type"; params: z.infer<typeof keyboardTypeAction> }
  | { name: "select_option"; params: z.infer<typeof selectOptionAction> }
  | { name: "upload_file"; params: z.infer<typeof uploadFileAction> }
  | { name: "wait_for_text"; params: z.infer<typeof waitForTextAction> }
  | { name: "wait_for_condition"; params: z.infer<typeof waitForConditionAction> }
  | { name: "wait_for_url"; params: z.infer<typeof waitForUrlAction> }
  | { name: "go_back"; params: z.infer<typeof noParamsAction> }
  | { name: "go_forward"; params: z.infer<typeof noParamsAction> }
  | { name: "refresh"; params: z.infer<typeof noParamsAction> }
  | { name: "new_tab"; params: z.infer<typeof newTabAction> }
  | { name: "switch_tab"; params: z.infer<typeof switchTabAction> }
  | { name: "close_tab"; params: z.infer<typeof closeTabAction> }
  | { name: "close_browser"; params: z.infer<typeof noParamsAction> }
  | { name: "search_page"; params: z.infer<typeof searchPageAction> }
  | { name: "find_elements"; params: z.infer<typeof findElementsAction> }
  | { name: "get_dropdown_options"; params: z.infer<typeof getDropdownOptionsAction> }
  | { name: "find_text"; params: z.infer<typeof findTextAction> }
  | { name: "screenshot"; params: z.infer<typeof screenshotAction> }
  | { name: "save_as_pdf"; params: z.infer<typeof saveAsPdfAction> }
  | { name: "extract_content"; params: z.infer<typeof extractContentAction> }
  | { name: "focus_area"; params: z.infer<typeof focusAreaAction> }
  | { name: "click_by"; params: z.infer<typeof clickByAction> }
  | { name: "type_by"; params: z.infer<typeof typeByAction> }
  | { name: "select_by"; params: z.infer<typeof selectByAction> }
  | { name: "hover"; params: z.infer<typeof hoverAction> }
  | { name: "dblclick"; params: z.infer<typeof dblclickAction> }
  | { name: "eval"; params: z.infer<typeof evalAction> }
  | { name: "find_by_role"; params: z.infer<typeof findByRoleAction> }
  | { name: "find_by_text"; params: z.infer<typeof findByTextAction> }
  | { name: "find_by_testid"; params: z.infer<typeof findByTestidAction> }
  | { name: "dialog_handle"; params: z.infer<typeof dialogHandleAction> }
  | { name: "network_har_start"; params: z.infer<typeof networkHarStartAction> }
  | { name: "network_har_stop"; params: z.infer<typeof networkHarStopAction> }
  | { name: "network_list_requests"; params: z.infer<typeof networkListRequestsAction> }
  | { name: "set_viewport"; params: z.infer<typeof setViewportAction> }
  | { name: "console_start"; params: z.infer<typeof consoleStartAction> }
  | { name: "console_read"; params: z.infer<typeof consoleReadAction> }
  | { name: "console_stop"; params: z.infer<typeof consoleStopAction> }
  | { name: "profiler_start"; params: z.infer<typeof profilerStartAction> }
  | { name: "profiler_stop"; params: z.infer<typeof profilerStopAction> }
  | { name: "done"; params: z.infer<typeof doneAction> };
