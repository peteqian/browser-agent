import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import {
  VERSION,
  type EnvId,
  type ProviderId,
  type TransportId,
} from "@peteqian/browser-agent-sdk";
import { parseAllowedDomainsInput } from "@peteqian/browser-agent-sdk/internal";

import { printHelp } from "./agent-task-help";

export const PROVIDERS: readonly ProviderId[] = ["codex", "claude", "openai", "anthropic"];
export const TRANSPORTS: readonly (TransportId | "auto")[] = [
  "auto",
  "sdk-agent",
  "sdk-api",
  "cli",
];
export const ENVS: readonly (EnvId | "auto")[] = ["auto", "local", "cloud"];
export const ENGINES = ["chrome", "lightpanda"] as const;
export type EngineId = (typeof ENGINES)[number];
export const FINGERPRINT_MODES = ["stealth", "native"] as const;
export type FingerprintMode = (typeof FINGERPRINT_MODES)[number];

export interface CliOptions {
  task: string;
  url?: string;
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
  decisionMode?: "tool" | "json";
  env?: EnvId | "auto";
  outputFile?: string;
  probe: boolean;
  engine: EngineId;
  cdpUrl?: string;
  autoConsent: boolean;
  fingerprintMode: FingerprintMode;
  profile?: string;
  storageStatePath?: string;
  summary: boolean;
  fullSnapshots: boolean;
  allowedDomains?: string[];
  initScripts?: string[];
}

interface ConfigFile {
  url?: string;
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
  cdpUrl?: string;
  autoConsent?: boolean;
  fingerprintMode?: FingerprintMode;
  profile?: string;
  storageStatePath?: string;
  allowedDomains?: string[];
  initScripts?: string[];
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

export async function buildOptions(argv: string[]): Promise<CliOptions> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    strict: true,
    options: {
      url: { type: "string" },
      headless: { type: "boolean" },
      "no-headless": { type: "boolean" },
      provider: { type: "string" },
      model: { type: "string" },
      "api-key": { type: "string" },
      "base-url": { type: "string" },
      effort: { type: "string" },
      transport: { type: "string" },
      "decision-mode": { type: "string" },
      env: { type: "string" },
      "decision-timeout": { type: "string" },
      "step-timeout": { type: "string" },
      "action-timeout": { type: "string" },
      "max-failures": { type: "string" },
      "output-file": { type: "string" },
      engine: { type: "string" },
      "cdp-url": { type: "string" },
      "auto-consent": { type: "boolean" },
      "no-auto-consent": { type: "boolean" },
      "fingerprint-mode": { type: "string" },
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
  const fingerprintMode: FingerprintMode = values["fingerprint-mode"]
    ? parseEnum<FingerprintMode>(
        values["fingerprint-mode"] as string,
        FINGERPRINT_MODES,
        "--fingerprint-mode",
      )
    : (config.fingerprintMode ?? "stealth");

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
    decisionMode:
      values["decision-mode"] === "tool" || values["decision-mode"] === "json"
        ? values["decision-mode"]
        : undefined,
    env,
    outputFile: (values["output-file"] as string | undefined) ?? config.outputFile,
    probe: Boolean(values.probe),
    engine,
    cdpUrl: (values["cdp-url"] as string | undefined) ?? config.cdpUrl,
    autoConsent,
    fingerprintMode,
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
