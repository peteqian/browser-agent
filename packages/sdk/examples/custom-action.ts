import { z } from "zod";

import {
  createDefaultActionRegistry,
  runAgent,
  type ActionDefinition,
  type ActionResult,
} from "../src/index";

const readTitle: ActionDefinition<"read_title", Record<string, never>> = {
  name: "read_title",
  description: "Read the current page title and return it as action data.",
  schema: z.object({}),
  run: async (_params, context): Promise<ActionResult> => {
    const title = await context.page.title();

    return {
      ok: true,
      message: `Page title: ${title}`,
      data: { title },
    };
  },
};

const actions = createDefaultActionRegistry();
actions.register(readTitle);

const result = await runAgent({
  task: "Open example.com, use read_title, then finish with a short summary.",
  startUrl: "https://example.com",
  maxSteps: 4,
  launch: { headless: true },
  actions,
  decide: async (input) => {
    if (!input.history.some((entry) => entry.action === "read_title")) {
      return {
        done: false,
        actions: [{ name: "read_title", params: {} }],
      };
    }

    return {
      done: true,
      success: true,
      summary: input.history.at(-1)?.result ?? "Read the page title.",
      actions: [{ name: "done", params: { success: true, summary: "Read the page title." } }],
    };
  },
});

console.log(JSON.stringify(result, null, 2));
