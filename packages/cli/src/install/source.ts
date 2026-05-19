import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { GLOBAL_COMMAND, NPX_COMMAND, PKG_NAME, type ResolvedCommand, type SourceId } from "./snippet";

/** Walk up from `start` looking for the CLI package root. Returns absolute path or null. */
export function findLocalCheckout(start: string = process.cwd()): string | null {
  let dir = resolve(start);
  while (true) {
    const candidate = resolve(dir, "packages/cli/package.json");
    if (existsSync(candidate)) {
      try {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { name?: string };
        if (pkg.name === PKG_NAME) return resolve(dir, "packages/cli");
      } catch {
        // continue
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function resolveSource(id: SourceId, cliRoot?: string | null): ResolvedCommand {
  if (id === "npx") return NPX_COMMAND;
  if (id === "global") return GLOBAL_COMMAND;
  if (id === "local") {
    const root = cliRoot ?? findLocalCheckout();
    if (!root) {
      throw new Error(
        "Cannot use --source local: not inside an @peteqian/browser-agent checkout.",
      );
    }
    const mcpPath = resolve(root, "dist/bin/mcp.js");
    if (!existsSync(mcpPath)) {
      throw new Error(
        `Local checkout found at ${root} but ${mcpPath} is missing. Run \`bun run build\` first.`,
      );
    }
    return { command: "node", args: [mcpPath] };
  }
  throw new Error(`Unknown source: ${id}`);
}
