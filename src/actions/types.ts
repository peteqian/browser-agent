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
});

export const doneAction = z.object({
  success: z.boolean(),
  summary: z.string(),
  data: z.unknown().optional(),
});

export const actionSchemas = {
  navigate: navigateAction,
  click: clickAction,
  type: typeAction,
  scroll: scrollAction,
  wait: waitAction,
  send_keys: sendKeysAction,
  select_option: selectOptionAction,
  upload_file: uploadFileAction,
  wait_for_text: waitForTextAction,
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
  done: doneAction,
} as const;

export type ActionName = keyof typeof actionSchemas;

export type Action =
  | { name: "navigate"; params: z.infer<typeof navigateAction> }
  | { name: "click"; params: z.infer<typeof clickAction> }
  | { name: "type"; params: z.infer<typeof typeAction> }
  | { name: "scroll"; params: z.infer<typeof scrollAction> }
  | { name: "wait"; params: z.infer<typeof waitAction> }
  | { name: "send_keys"; params: z.infer<typeof sendKeysAction> }
  | { name: "select_option"; params: z.infer<typeof selectOptionAction> }
  | { name: "upload_file"; params: z.infer<typeof uploadFileAction> }
  | { name: "wait_for_text"; params: z.infer<typeof waitForTextAction> }
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
  | { name: "done"; params: z.infer<typeof doneAction> };
