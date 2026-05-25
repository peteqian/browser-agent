import { parseArgs } from "node:util";

import { clearProfile, listProfiles, showProfile, type ProfileSummary } from "../profiles";

function printHelp(): void {
  console.log(`browser-agent profile — manage named persistent browser profiles.

Usage:
  browser-agent profile list [--json]
  browser-agent profile show <name> [--json]
  browser-agent profile clear <name> [--json]

Flags:
  --json      Emit JSON only.
  --help, -h
`);
}

function emit(json: boolean, value: unknown, human?: string): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  process.stdout.write(`${human ?? `${JSON.stringify(value, null, 2)}\n`}`);
  if (human !== undefined) process.stdout.write("\n");
}

export async function runProfileCommand(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return argv.length === 0 ? 1 : 0;
  }

  const sub = argv[0];
  const { values, positionals } = parseArgs({
    args: argv.slice(1),
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printHelp();
    return 0;
  }

  const json = Boolean(values.json);
  if (sub === "list") {
    const profiles = listProfiles();
    emit(
      json,
      { profiles },
      profiles.length === 0 ? "(no profiles)" : profiles.map(profileLine).join("\n"),
    );
    return 0;
  }

  const name = positionals[0];
  if (!name) throw new Error(`profile ${sub}: missing <name>`);

  if (sub === "show") {
    const profile = showProfile(name);
    emit(json, profile, profileDetails(profile));
    return profile.exists ? 0 : 1;
  }

  if (sub === "clear") {
    const before = showProfile(name);
    const profile = clearProfile(name);
    emit(json, profile, before.exists ? `cleared ${before.name}` : `${before.name} not found`);
    return 0;
  }

  throw new Error(`Unknown profile subcommand: ${sub}. Run 'browser-agent profile --help'.`);
}

function profileLine(profile: ProfileSummary): string {
  const state = profile.storageStateExists ? "state" : "no-state";
  const userData = profile.userDataDirExists ? "user-data" : "no-user-data";
  return `${profile.name}\t${state}\t${userData}\t${profile.rootDir}`;
}

function profileDetails(profile: ProfileSummary): string {
  return `${profile.name}
  path:          ${profile.rootDir}
  user data:     ${profile.userDataDirExists ? profile.userDataDir : "(missing)"}
  storage state: ${profile.storageStateExists ? profile.storageStatePath : "(missing)"}
  mtime:         ${profile.mtime ?? "(missing)"}`;
}
