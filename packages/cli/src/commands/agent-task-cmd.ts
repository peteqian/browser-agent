import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  createDecide,
  resolveTransport,
  runAgent,
  VERSION,
  type AgentEvent,
  type EnvId,
  type ProviderId,
  type StepInfo,
  type TransportId,
} from "@peteqian/browser-agent-sdk";
import { parseAllowedDomainsInput } from "@peteqian/browser-agent-sdk/internal";

import { SummaryCollector, renderSummary } from "./summary";
import { resolveBrowserPaths } from "../profiles";

const PROVIDERS: readonly ProviderId[] = ["codex", "claude", "openai", "anthropic"];
const TRANSPORTS: readonly (TransportId | "auto")[] = ["auto", "sdk-agent", "sdk-api", "cli"];
const ENVS: readonly (EnvId | "auto")[] = ["auto", "local", "cloud"];
const ENGINES = ["chrome", "lightpanda"] as const;
type EngineId = (typeof ENGINES)[number];

interface CliOptions {
  task: string;
  url?: string;
  maxSteps?: number;
  headless: boolean;
  model?: string;
  verbose: boolean;
  json: boolean;
  provider: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  effort?: string;
  decisionTimeoutMs?: number;
  stepTimeoutMs?: number;
  actionTimeoutMs?: number;
  maxFailures?: number;
  transport?: TransportId | "auto";
  env?: EnvId | "auto";
  outputFile?: string;
  probe: boolean;
  engine: EngineId;
  autoConsent: boolean;
  profile?: string;
  storageStatePath?: string;
  summary: boolean;
  fullSnapshots: boolean;
  allowedDomains?: string[];
  initScripts?: string[];
}

interface ConfigFile {
  url?: string;
  maxSteps?: number;
  headless?: boolean;
  model?: string;
  provider?: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  effort?: string;
  decisionTimeoutMs?: number;
  stepTimeoutMs?: number;
  actionTimeoutMs?: number;
  maxFailures?: number;
  transport?: TransportId | "auto";
  env?: EnvId | "auto";
  outputFile?: string;
  engine?: EngineId;
  autoConsent?: boolean;
  profile?: string;
  storageStatePath?: string;
  allowedDomains?: string[];
  initScripts?: string[];
}

export function printHelp(): void {
  console.log(`browser-agent ${VERSION} — run a browser task with an LLM agent.

Usage:
  browser-agent "<task>" [flags]
  browser-agent browser status              # check browser executable
  browser-agent browser install             # install managed Chromium
  browser-agent install [--help]              # configure MCP clients
  browser-agent dashboard [--port 3217]       # run local HTTP dashboard
  browser-agent profile <subcommand> [--help] # manage persistent profiles
  browser-agent state <subcommand> [--help]   # manage saved-state vault
  browser-agent --stdin                       # read task from stdin
  browser-agent --probe --provider <p>        # show what transport would resolve
  browser-agent --version                     # print version
  browser-agent --help

Flags:
  --url <url>                Start URL to navigate to before the first step.
  --max-steps <n>            Hard cap on loop iterations (default 40).
  --no-headless              Show the browser window.
  --headless                 Run headless (default).
  --engine <e>               ${ENGINES.join(" | ")}  (default: chrome)
  --auto-consent             Auto-dismiss common cookie/consent banners (default).
  --no-auto-consent          Disable auto consent handling.
  --profile <name>           Named persistent browser profile under ~/.browser-agent.
  --storage-state <path>     Load/save cookies + localStorage at this path.
  --allowed-domains <list>   Comma-separated allowlist (e.g. "example.com,*.api.com").
                             Rejects navigate/new_tab to URLs outside the list.
  --init-script <path>       Path to a JS file injected via Page.addScriptToEvaluateOnNewDocument
                             before every navigation. Repeatable.

Provider:
  --provider <p>             ${PROVIDERS.join(" | ")}  (default: codex)
  --model <id>               Override the default model for the provider.
  --api-key <k>              API key. Prefer env vars over CLI flag.
  --base-url <url>           Base URL for OpenAI-compatible providers.
  --effort <e>               Codex reasoning effort: minimal|low|medium|high|xhigh.

Transport:
  --transport <t>            ${TRANSPORTS.join(" | ")}  (default: auto)
  --env <e>                  ${ENVS.join(" | ")}  (default: auto)

Timeouts (ms):
  --decision-timeout <ms>    Per-decision LLM call timeout (default 120000).
  --step-timeout <ms>        Per-step page-context preparation timeout (default 180000).
  --action-timeout <ms>      Per-action execution timeout (default 30000).
  --max-failures <n>         Consecutive failures before giving up (default 5).

Output:
  --json                     Stream events as JSONL on stdout instead of result blob.
  --output-file <path>       Write final result JSON to file (still printed on stdout).
  --verbose, -v              Print every AgentEvent and step trace as
                             timestamped JSONL on stderr. Composes with --json.
  --summary                  After the run, print a per-step timing table to stdout
                             (decision / snapshot / action breakdown).
  --full-snapshots           Always send the full DOM snapshot instead of a per-step diff.

Other:
  --config <path>            Load defaults from JSON file (CLI flags override).
  --stdin                    Read task from stdin.
  --probe                    Print resolved transport for the provider and exit.
  --version, -V              Print version.
  --help, -h                 This help.

Env vars:
  CODEX_BIN                  Path to codex binary (default: codex).
  CLAUDE_BIN                 Path to claude binary (default: claude).
  OPENAI_API_KEY             Used when --provider=openai|codex SDK and key omitted.
  ANTHROPIC_API_KEY          Used when --provider=anthropic|claude and key omitted.
  BROWSER_AGENT_ENV          Force runtime env: local|cloud.

Examples:
  browser-agent "Go to example.com and report the H1"
  browser-agent "Find top 5 frontend jobs on seek.com.au" --url https://seek.com.au --max-steps 30
  browser-agent "Summarize page" --provider openai --model gpt-4.1-mini
  echo "open google.com" | browser-agent --stdin
  browser-agent --probe --provider claude
`);
}

function loadConfig(path: string): ConfigFile {
  try {
    const raw = readFileSync(path, "utf-8");
    return JSON.parse(raw) as ConfigFile;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to load --config ${path}: ${message}`, { cause: err });
  }
}

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data.trim()));
    process.stdin.on("error", reject);
  });
}

function parseEnum<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!allowed.includes(value as T)) {
    throw new Error(`${flag} must be one of: ${allowed.join(", ")}. Got: ${value}`);
  }
  return value as T;
}

function parseInt(value: string, flag: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error(`${flag} must be a non-negative integer. Got: ${value}`);
  }
  return n;
}

function loadInitScripts(paths: string[] | undefined): string[] | undefined {
  if (!paths || paths.length === 0) return undefined;
  const sources: string[] = [];
  for (const p of paths) {
    try {
      sources.push(readFileSync(p, "utf8"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`--init-script: cannot read ${p}: ${msg}`, { cause: err });
    }
  }
  return sources;
}

function writeVerbose(event: string, data: unknown): void {
  console.error(JSON.stringify({ t: new Date().toISOString(), event, data }));
}

function writeJsonl(event: AgentEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function buildOptions(argv: string[]): Promise<CliOptions> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      url: { type: "string" },
      "max-steps": { type: "string" },
      headless: { type: "boolean" },
      "no-headless": { type: "boolean" },
      provider: { type: "string" },
      model: { type: "string" },
      "api-key": { type: "string" },
      "base-url": { type: "string" },
      effort: { type: "string" },
      transport: { type: "string" },
      env: { type: "string" },
      "decision-timeout": { type: "string" },
      "step-timeout": { type: "string" },
      "action-timeout": { type: "string" },
      "max-failures": { type: "string" },
      "output-file": { type: "string" },
      engine: { type: "string" },
      "auto-consent": { type: "boolean" },
      "no-auto-consent": { type: "boolean" },
      profile: { type: "string" },
      "storage-state": { type: "string" },
      "allowed-domains": { type: "string" },
      "init-script": { type: "string", multiple: true },
      config: { type: "string" },
      stdin: { type: "boolean" },
      json: { type: "boolean" },
      summary: { type: "boolean" },
      "full-snapshots": { type: "boolean" },
      probe: { type: "boolean" },
      verbose: { type: "boolean", short: "v" },
      version: { type: "boolean", short: "V" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }
  if (values.version) {
    console.log(VERSION);
    process.exit(0);
  }

  const config: ConfigFile = values.config ? loadConfig(values.config) : {};

  const provider = parseEnum<ProviderId>(
    (values.provider as string) ?? config.provider ?? "codex",
    PROVIDERS,
    "--provider",
  );
  const transport = values.transport
    ? parseEnum(values.transport as string, TRANSPORTS, "--transport")
    : config.transport;
  const env = values.env ? parseEnum(values.env as string, ENVS, "--env") : config.env;
  const engine: EngineId = values.engine
    ? parseEnum<EngineId>(values.engine as string, ENGINES, "--engine")
    : (config.engine ?? "chrome");

  const headless = values["no-headless"]
    ? false
    : values.headless
      ? true
      : (config.headless ?? true);
  const autoConsent = values["no-auto-consent"]
    ? false
    : values["auto-consent"]
      ? true
      : (config.autoConsent ?? true);

  let task = positionals.join(" ").trim();
  if (values.stdin) {
    const fromStdin = await readStdin();
    task = task ? `${task} ${fromStdin}`.trim() : fromStdin;
  }

  if (!task && !values.probe) {
    printHelp();
    process.exit(1);
  }

  const maxSteps = values["max-steps"]
    ? parseInt(values["max-steps"] as string, "--max-steps")
    : config.maxSteps;
  const decisionTimeoutMs = values["decision-timeout"]
    ? parseInt(values["decision-timeout"] as string, "--decision-timeout")
    : config.decisionTimeoutMs;
  const stepTimeoutMs = values["step-timeout"]
    ? parseInt(values["step-timeout"] as string, "--step-timeout")
    : config.stepTimeoutMs;
  const actionTimeoutMs = values["action-timeout"]
    ? parseInt(values["action-timeout"] as string, "--action-timeout")
    : config.actionTimeoutMs;
  const maxFailures = values["max-failures"]
    ? parseInt(values["max-failures"] as string, "--max-failures")
    : config.maxFailures;

  return {
    task,
    url: (values.url as string | undefined) ?? config.url,
    maxSteps,
    headless,
    model: (values.model as string | undefined) ?? config.model,
    verbose: Boolean(values.verbose),
    json: Boolean(values.json),
    provider,
    apiKey: (values["api-key"] as string | undefined) ?? config.apiKey,
    baseUrl: (values["base-url"] as string | undefined) ?? config.baseUrl,
    effort: (values.effort as string | undefined) ?? config.effort,
    decisionTimeoutMs,
    stepTimeoutMs,
    actionTimeoutMs,
    maxFailures,
    transport,
    env,
    outputFile: (values["output-file"] as string | undefined) ?? config.outputFile,
    probe: Boolean(values.probe),
    engine,
    autoConsent,
    profile: (values.profile as string | undefined) ?? config.profile,
    storageStatePath: (values["storage-state"] as string | undefined) ?? config.storageStatePath,
    summary: Boolean(values.summary),
    fullSnapshots: Boolean(values["full-snapshots"]),
    allowedDomains: parseAllowedDomainsInput(
      (values["allowed-domains"] as string | undefined) ?? config.allowedDomains,
    ),
    initScripts: loadInitScripts(
      (values["init-script"] as string[] | undefined) ?? config.initScripts,
    ),
  };
}

export async function runAgentTaskCommand(argv: string[]): Promise<number> {
  const opts = await buildOptions(argv);

  if (opts.probe) {
    const probeResult = resolveTransport({
      provider: opts.provider,
      model: opts.model ?? "probe-only",
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      effort: opts.effort,
      env: opts.env,
      transport: opts.transport,
    });
    console.log(JSON.stringify(probeResult.resolution, null, 2));
    return 0;
  }

  const { decide, resolution } = createDecide({
    provider: opts.provider,
    model: opts.model,
    apiKey: opts.apiKey,
    baseURL: opts.baseUrl,
    effort: opts.effort,
    env: opts.env,
    transport: opts.transport,
    onCodexRaw: opts.verbose ? (raw, step) => writeVerbose("model.raw", { step, raw }) : undefined,
  });

  const jsonlOnEvent = opts.json ? writeJsonl : undefined;
  const verboseOnEvent = opts.verbose
    ? (event: AgentEvent) => writeVerbose(`event.${event.type}`, event)
    : undefined;
  const summaryCollector = opts.summary ? new SummaryCollector() : undefined;
  const summaryOnEvent: ((event: AgentEvent) => void) | undefined = summaryCollector
    ? (event) => summaryCollector.observe(event)
    : undefined;
  const handlers = [jsonlOnEvent, verboseOnEvent, summaryOnEvent].filter(
    (h): h is (event: AgentEvent) => void => Boolean(h),
  );
  const onEvent: ((event: AgentEvent) => void) | undefined =
    handlers.length === 0
      ? undefined
      : handlers.length === 1
        ? handlers[0]
        : (event) => {
            for (const h of handlers) h(event);
          };

  const abortController = new AbortController();
  let signalCount = 0;
  const onSignal = (signal: string): void => {
    signalCount += 1;
    if (signalCount === 1) {
      console.error(
        `\nbrowser-agent: ${signal} received, finishing current step and closing browser...`,
      );
      abortController.abort(signal);
    } else {
      console.error(`browser-agent: ${signal} again, force exit.`);
      process.exit(130);
    }
  };
  const handleInt = (): void => onSignal("SIGINT");
  const handleTerm = (): void => onSignal("SIGTERM");
  process.on("SIGINT", handleInt);
  process.on("SIGTERM", handleTerm);

  const browserPaths = resolveBrowserPaths({
    profile: opts.profile,
    storageStatePath: opts.storageStatePath,
  });
  const agentOptions = {
    task: opts.task,
    startUrl: opts.url,
    maxSteps: opts.maxSteps,
    decisionTimeoutMs: opts.decisionTimeoutMs,
    stepTimeoutMs: opts.stepTimeoutMs,
    actionTimeoutMs: opts.actionTimeoutMs,
    maxFailures: opts.maxFailures,
    launch: {
      headless: opts.headless,
      autoConsent: opts.autoConsent,
      userDataDir: browserPaths.userDataDir,
      storageStatePath: browserPaths.storageStatePath,
      initScripts: opts.initScripts,
      ...(opts.engine === "lightpanda" ? { channel: "lightpanda" as const } : {}),
    },
    decide,
    transportResolution: resolution,
    vision: "auto" as const,
    fullSnapshots: opts.fullSnapshots,
    allowedDomains: opts.allowedDomains,
    signal: abortController.signal,
    onEvent,
    onStep: (step: StepInfo) => {
      if (opts.verbose) {
        writeVerbose("agent.step", step);
      }
      if (!opts.json) {
        const short = step.action.name === "done" ? "" : ` -> ${step.result.message}`;
        console.error(
          `[${step.step}] ${step.action.name}(${JSON.stringify(step.action.params)})${short}`,
        );
      }
    },
  };

  let result;
  try {
    result = await runAgent(agentOptions);
  } finally {
    process.off("SIGINT", handleInt);
    process.off("SIGTERM", handleTerm);
  }

  const resultJson = JSON.stringify(result, null, 2);
  if (opts.outputFile) {
    writeFileSync(opts.outputFile, resultJson);
  }
  if (!opts.json) {
    console.log(resultJson);
  }
  if (summaryCollector) {
    console.log(renderSummary(summaryCollector.snapshot()));
  }
  return result.success ? 0 : 1;
}
