import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { resolveSkillsDir } from "./loader";

export interface SkillSummary {
  name: string;
  summary: string;
}

export interface SkillContent {
  name: string;
  markdown: string;
}

/**
 * Discovers and loads bundled skill markdown.
 *
 * A skill is a subdirectory of `packages/cli/skills/` containing a
 * required `SKILL.md` and optional `references/*.md` files. `get()`
 * returns the SKILL.md body followed by each reference, each prefixed
 * with an H1 header naming the reference file.
 */
export class SkillRegistry {
  private readonly skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir ?? resolveSkillsDir();
  }

  async list(): Promise<SkillSummary[]> {
    const entries = await readdir(this.skillsDir, { withFileTypes: true });
    const out: SkillSummary[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillFile = join(this.skillsDir, entry.name, "SKILL.md");
      let raw: string;
      try {
        raw = await readFile(skillFile, "utf-8");
      } catch {
        continue;
      }
      out.push({ name: entry.name, summary: extractSummary(raw) });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }

  async get(name: string): Promise<SkillContent | null> {
    if (!isSafeName(name)) return null;
    const dir = join(this.skillsDir, name);
    const skillPath = join(dir, "SKILL.md");
    let main: string;
    try {
      main = await readFile(skillPath, "utf-8");
    } catch {
      return null;
    }

    const referencesDir = join(dir, "references");
    const refs: { file: string; body: string }[] = [];
    try {
      const refStat = await stat(referencesDir);
      if (refStat.isDirectory()) {
        const entries = await readdir(referencesDir, { withFileTypes: true });
        const mdFiles = entries
          .filter((e) => e.isFile() && e.name.endsWith(".md"))
          .map((e) => e.name)
          .sort();
        for (const file of mdFiles) {
          const body = await readFile(join(referencesDir, file), "utf-8");
          refs.push({ file, body });
        }
      }
    } catch {
      // No references directory — that's fine.
    }

    const parts = [main.trimEnd()];
    for (const ref of refs) {
      parts.push(`# ${ref.file}\n\n${ref.body.trimEnd()}`);
    }
    return { name, markdown: `${parts.join("\n\n")}\n` };
  }
}

function extractSummary(markdown: string): string {
  // Skip leading H1 (the skill title) and return the first non-empty
  // paragraph as a one-line summary.
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length && (lines[i]?.trim() === "" || lines[i]?.startsWith("# "))) {
    i += 1;
  }
  const buf: string[] = [];
  for (; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    if (line.trim() === "") {
      if (buf.length > 0) break;
      continue;
    }
    if (line.startsWith("#")) break;
    buf.push(line.trim());
  }
  return buf.join(" ").trim();
}

function isSafeName(name: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(name);
}
