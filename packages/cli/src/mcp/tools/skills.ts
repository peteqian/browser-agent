import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { SkillRegistry } from "../../skills/registry";
import { jsonResult, textResult } from "../helpers";

export function registerSkillTools(server: McpServer): void {
  const registerTool = server.registerTool.bind(server) as ToolRegistrar;
  const registry = new SkillRegistry();

  registerTool(
    "list_skills",
    {
      description: "List bundled browser-agent skills (name + one-line summary).",
      inputSchema: {},
    },
    async () => {
      const skills = await registry.list();
      return jsonResult({ skills });
    },
  );

  registerTool(
    "get_skill",
    {
      description:
        "Return the combined markdown for a bundled skill (SKILL.md plus references). Load at task start to ground tool usage.",
      inputSchema: { name: z.string().min(1) },
    },
    async ({ name }) => {
      const content = await registry.get(name);
      if (!content) {
        return textResult(`Unknown skill: ${name}`);
      }
      return textResult(content.markdown);
    },
  );
}

type ToolRegistrar = (
  name: string,
  config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
  cb: (args: any, extra: any) => unknown,
) => void;
