import { copyFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";

import {
  cleanAllStates,
  clearState,
  listStates,
  loadState,
  renameState,
  resolveStateVaultDir,
  showState,
} from "@peteqian/browser-agent-sdk";
import { readStorageStateFile, writeStorageStateFile } from "@peteqian/browser-agent-sdk/internal";

function printHelp(): void {
  console.log(`browser-agent state — manage the named-state vault.

Usage:
  browser-agent state list [--json]
  browser-agent state show <name> [--json]
  browser-agent state save <name> --storage-state-path <path> [--json]
  browser-agent state load <name> [--apply-to <path>] [--json]
  browser-agent state rename <old> <new> [--json]
  browser-agent state clear <name> [--json]
  browser-agent state clean [--json]

Flags:
  --json                  Emit JSON only.
  --storage-state-path    For 'save': source storage-state file to import.
  --apply-to              For 'load': write the saved state to this path so
                          subsequent launches pick it up.
  --help, -h
`);
}

function emit(json: boolean, value: unknown, human?: string): void {
  if (json) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  } else if (human !== undefined) {
    process.stdout.write(`${human}\n`);
  } else {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  }
}

export async function runStateCommand(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
    printHelp();
    return argv.length === 0 ? 1 : 0;
  }

  const sub = argv[0];
  const rest = argv.slice(1);

  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      json: { type: "boolean" },
      "storage-state-path": { type: "string" },
      "apply-to": { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printHelp();
    return 0;
  }

  const json = Boolean(values.json);

  switch (sub) {
    case "list": {
      const items = await listStates();
      emit(
        json,
        { dir: resolveStateVaultDir(), states: items },
        items.length === 0
          ? `(no states in ${resolveStateVaultDir()})`
          : items.map((s) => `${s.name}\t${s.sizeBytes}B\t${s.mtime}\t${s.path}`).join("\n"),
      );
      return 0;
    }
    case "show": {
      const name = positionals[0];
      if (!name) throw new Error("state show: missing <name>");
      const summary = await showState(name);
      emit(
        json,
        summary,
        `${summary.name}\n  path:    ${summary.path}\n  cookies: ${summary.cookiesCount}\n  origins: ${summary.originsCount}\n  size:    ${summary.sizeBytes}B\n  mtime:   ${summary.mtime}`,
      );
      return 0;
    }
    case "save": {
      const name = positionals[0];
      if (!name) throw new Error("state save: missing <name>");
      const source = values["storage-state-path"] as string | undefined;
      if (!source) {
        throw new Error(
          "state save: --storage-state-path <path> required. Live capture requires the MCP save_state tool.",
        );
      }
      const parsed = await readStorageStateFile(source);
      if (!parsed) {
        throw new Error(`state save: source file not found: ${source}`);
      }
      const destDir = resolveStateVaultDir();
      await mkdir(destDir, { recursive: true });
      const destPath = `${destDir}/${name}.json`;
      await copyFile(source, destPath);
      const summary = await showState(name);
      emit(json, summary, `saved ${name} -> ${summary.path}`);
      return 0;
    }
    case "load": {
      const name = positionals[0];
      if (!name) throw new Error("state load: missing <name>");
      const applyTo = values["apply-to"] as string | undefined;
      const state = await loadState(name);
      const summary = await showState(name);
      if (applyTo) {
        await writeStorageStateFile(applyTo, state);
      }
      emit(
        json,
        { ...summary, appliedTo: applyTo ?? null },
        applyTo
          ? `loaded ${name} -> ${applyTo}`
          : `loaded ${name} (use --apply-to <path> or pass --storage-state-path to your next launch)\npath: ${summary.path}`,
      );
      return 0;
    }
    case "rename": {
      const oldName = positionals[0];
      const newName = positionals[1];
      if (!oldName || !newName) throw new Error("state rename: requires <old> <new>");
      const result = await renameState(oldName, newName);
      emit(json, result, `renamed ${oldName} -> ${newName}`);
      return 0;
    }
    case "clear": {
      const name = positionals[0];
      if (!name) throw new Error("state clear: missing <name>");
      const result = await clearState(name);
      emit(json, result, result.removed ? `cleared ${name}` : `${name} not found (no-op)`);
      return 0;
    }
    case "clean": {
      const result = await cleanAllStates();
      emit(
        json,
        result,
        result.removed.length === 0
          ? "(nothing to clean)"
          : `cleaned ${result.removed.length}: ${result.removed.join(", ")}`,
      );
      return 0;
    }
    default:
      throw new Error(`Unknown state subcommand: ${sub}. Run 'browser-agent state --help'.`);
  }
}
