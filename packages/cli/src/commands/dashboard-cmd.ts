import { parseArgs } from "node:util";

import { getDashboardStatus, runDashboard } from "../dashboard/server";

export async function runDashboardCommand(argv: string[]): Promise<number> {
  if (argv[0] === "status") return runDashboardStatus();
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    strict: true,
    options: {
      host: { type: "string" },
      port: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`browser-agent dashboard — run local session dashboard.

Usage:
  browser-agent dashboard [--host 127.0.0.1] [--port 3217]
  browser-agent dashboard status
`);
    return 0;
  }
  const port = values.port ? parsePort(values.port as string) : 3217;
  const handle = await runDashboard({
    host: (values.host as string | undefined) ?? "127.0.0.1",
    port,
  });
  console.log(`browser-agent dashboard listening on ${handle.url}`);
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await handle.close();
  return 0;
}

export async function runDashboardStatus(): Promise<number> {
  const status = await getDashboardStatus({ cleanStale: true });
  console.log(JSON.stringify(status, null, 2));
  return status.running ? 0 : 1;
}

function parsePort(value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0 || n > 65535) {
    throw new Error(`--port must be an integer 1..65535. Got: ${value}`);
  }
  return n;
}
