import { parseArgs } from "node:util";

import {
  ensureBrowserExecutable,
  getBrowserInstallStatus,
  type BrowserChannel,
} from "@peteqian/browser-agent-sdk/internal";

const BROWSER_CHANNELS: readonly BrowserChannel[] = [
  "chromium",
  "chrome",
  "chrome-beta",
  "chrome-dev",
  "chrome-canary",
  "msedge",
  "msedge-beta",
  "msedge-dev",
  "msedge-canary",
  "lightpanda",
];

export { BROWSER_CHANNELS };

function parseChannel(value: string | undefined): BrowserChannel {
  if (!value) return "chromium";
  if (!BROWSER_CHANNELS.includes(value as BrowserChannel)) {
    throw new Error(`--channel must be one of: ${BROWSER_CHANNELS.join(", ")}. Got: ${value}`);
  }
  return value as BrowserChannel;
}

export async function runBrowserCommand(argv: string[]): Promise<number> {
  const subcommand = argv[0]?.startsWith("-") ? "status" : (argv[0] ?? "status");
  if (!["status", "install"].includes(subcommand)) {
    throw new Error(
      `Unknown browser subcommand: ${subcommand}. Run 'browser-agent browser --help'.`,
    );
  }

  const { values } = parseArgs({
    args: argv[0]?.startsWith("-") ? argv : argv.slice(1),
    allowPositionals: false,
    strict: true,
    options: {
      channel: { type: "string" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    console.log(`browser-agent browser — inspect or install the browser runtime.

Usage:
  browser-agent browser status [--channel chromium]
  browser-agent browser install [--channel chromium]

Flags:
  --channel <c>       ${BROWSER_CHANNELS.join(" | ")} (default: chromium)
  --json              Print machine-readable JSON
  --help, -h

Notes:
  install uses Playwright's managed Chromium download. It does not remove cookie
  banners by itself; use persistent profiles and auto-consent for that.
`);
    return 0;
  }

  const channel = parseChannel(values.channel as string | undefined);
  const result =
    subcommand === "install"
      ? await ensureBrowserExecutable(channel)
      : { ...getBrowserInstallStatus(channel), installedNow: false };

  if (values.json) {
    console.log(JSON.stringify(result, null, 2));
    return result.found ? 0 : 1;
  }

  if (result.found) {
    const installNote = result.installedNow ? "installed now" : "already available";
    console.log(`browser-agent browser: ${channel} ${installNote}`);
    console.log(`executable: ${result.executablePath}`);
    return 0;
  }

  if (!result.installable) {
    console.log(`browser-agent browser: ${channel} was not found and is not auto-installable.`);
    return 1;
  }

  console.log(`browser-agent browser: ${channel} was not found.`);
  console.log(`Run: browser-agent browser install --channel ${channel}`);
  return 1;
}
