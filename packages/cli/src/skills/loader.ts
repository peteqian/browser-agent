import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Resolve the absolute path to the bundled `skills/` directory.
 *
 * Walks up from this module's location looking for a sibling `skills/`
 * folder. Works in dev (`src/skills/loader.ts` → `packages/cli/skills`)
 * and after build (`dist/.../loader.js` → `packages/cli/skills`,
 * provided `skills` is listed in `package.json#files`).
 */
export function resolveSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  // Cap the walk so a misconfigured deploy fails fast instead of
  // climbing to the filesystem root.
  for (let i = 0; i < 8; i += 1) {
    const parent = dirname(dir);
    const candidate = resolve(parent, "skills");
    if (existsSync(candidate) && candidate !== dir) {
      return candidate;
    }
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `browser-agent: could not locate bundled skills/ directory starting from ${here}`,
  );
}
