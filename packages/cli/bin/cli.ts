#!/usr/bin/env node
import { runAgentTaskCommand } from "../src/commands/agent-task-cmd";
import { runBrowserCommand } from "../src/commands/browser-cmd";
import { runDashboardCommand } from "../src/commands/dashboard-cmd";
import { runInstallCommand } from "../src/commands/install-cmd";
import { runProfileCommand } from "../src/commands/profile";
import { runSkillsCommand } from "../src/commands/skills";
import { runStateCommand } from "../src/commands/state";

const SUBCOMMANDS: Record<string, (argv: string[]) => Promise<number>> = {
  browser: runBrowserCommand,
  install: runInstallCommand,
  dashboard: runDashboardCommand,
  skills: runSkillsCommand,
  profile: runProfileCommand,
  state: runStateCommand,
};

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const handler = argv[0] ? SUBCOMMANDS[argv[0]] : undefined;
  if (handler) return handler(argv.slice(1));
  return runAgentTaskCommand(argv);
}

main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`browser-agent: ${message}`);
    process.exit(1);
  });
