import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const EXPECTED_PKG_NAME = "@peteqian/browser-agent";

/**
 * Resolve the absolute path to the bundled `skills/` directory.
 *
 * Walks up from this module looking for a parent directory whose
 * `package.json` matches the CLI package name, then returns its sibling
 * `skills/` folder. Anchoring on `package.json#name` prevents accidentally
 * matching some other `skills/` dir in a deep monorepo.
 *
 * Works in dev (`src/skills/loader.ts` → `packages/cli/skills`) and after
 * build (`dist/.../loader.js` → `packages/cli/skills`, provided `skills`
 * is listed in `package.json#files`).
 */
export function resolveSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  for (let i = 0; i < 12; i += 1) {
    const pkgPath = resolve(dir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8")) as { name?: string };
        if (pkg.name === EXPECTED_PKG_NAME) {
          const candidate = resolve(dir, "skills");
          if (existsSync(candidate)) return candidate;
        }
      } catch {
        // Ignore malformed package.json and keep climbing.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `browser-agent: could not locate bundled skills/ directory starting from ${here}`,
  );
}
