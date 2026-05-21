import { describe, expect, test } from "bun:test";

import { SkillRegistry } from "./registry";

describe("SkillRegistry", () => {
  test("list() returns both bundled skills", async () => {
    const registry = new SkillRegistry();
    const skills = await registry.list();
    const names = skills.map((s) => s.name).toSorted();
    expect(names).toEqual(["core", "mcp"]);
    for (const skill of skills) {
      expect(skill.summary.length).toBeGreaterThan(0);
    }
  });

  test("get('core') returns combined markdown with references", async () => {
    const registry = new SkillRegistry();
    const content = await registry.get("core");
    expect(content).not.toBeNull();
    expect(content?.name).toBe("core");
    const md = content?.markdown ?? "";
    expect(md.length).toBeGreaterThan(0);
    // Combined output includes the references with their per-file H1.
    expect(md).toContain("# actions.md");
    expect(md).toContain("# snapshot.md");
  });

  test("get() returns null for unknown skill", async () => {
    const registry = new SkillRegistry();
    expect(await registry.get("nonexistent")).toBeNull();
  });

  test("get() rejects unsafe names", async () => {
    const registry = new SkillRegistry();
    expect(await registry.get("../core")).toBeNull();
    expect(await registry.get("core/references")).toBeNull();
  });
});
