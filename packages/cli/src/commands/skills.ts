import { parseArgs } from "node:util";

import { SkillRegistry } from "../skills/registry";

function printHelp(): void {
  console.log(`browser-agent skills — list and print bundled skill docs.

Usage:
  browser-agent skills list
  browser-agent skills get <name>

Skills ship with the binary; the markdown returned by \`get\` is the
canonical guidance for that version. Wire it into your host agent's
context at the start of a browser task.
`);
}

export async function runSkillsCommand(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help || positionals.length === 0) {
    printHelp();
    return values.help ? 0 : 1;
  }

  const sub = positionals[0];
  const registry = new SkillRegistry();

  if (sub === "list") {
    const skills = await registry.list();
    if (values.json) {
      console.log(JSON.stringify(skills, null, 2));
      return 0;
    }
    if (skills.length === 0) {
      console.log("(no skills bundled)");
      return 0;
    }
    for (const skill of skills) {
      console.log(`${skill.name}\t${skill.summary}`);
    }
    return 0;
  }

  if (sub === "get") {
    const name = positionals[1];
    if (!name) {
      console.error("browser-agent skills get: missing <name>");
      return 1;
    }
    const content = await registry.get(name);
    if (!content) {
      console.error(`browser-agent skills: unknown skill "${name}"`);
      return 1;
    }
    process.stdout.write(content.markdown);
    return 0;
  }

  console.error(`browser-agent skills: unknown subcommand "${sub}"`);
  printHelp();
  return 1;
}
