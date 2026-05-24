import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

import type { EnvId, GetNextActionFn, TransportId, TransportResolution } from "../agent/contracts";
import { detectEnv } from "./env";
import { createDefaultLogger, type Logger } from "../logger";
import { createOpenAIDecide } from "./openai";
import { createOpenAIToolDecide } from "./openaiTools";
import { createAnthropicDecide } from "./anthropic";
import { createCodexCliDecide } from "../agent/codexCliDecide";
import { createCodexSdkDecide } from "../agent/codexSdkDecide";
import { createClaudeCliDecide } from "../agent/claudeCliDecide";
import { createClaudeSdkDecide } from "../agent/claudeSdkDecide";

export type ProviderKind = "codex" | "claude" | "openai" | "anthropic";

export interface ResolveOptions {
  provider: ProviderKind;
  model: string;
  apiKey?: string;
  baseURL?: string;
  /** Codex-only: passed as model_reasoning_effort. */
  effort?: string;
  /** Codex-only: invoked with raw text per decision. */
  onCodexRaw?: (raw: string, step: number) => void;
  /** Optional callback to surface transport resolution outside the loop. */
  onResolve?: (resolution: TransportResolution) => void;
  /** Force a specific environment. */
  env?: EnvId | "auto";
  /** Force a specific transport. Skips fallback chain. */
  transport?: TransportId | "auto";
  /**
   * Decision encoding for API transports. "tool" uses native provider
   * tool-calling (one action per turn, persistent lean conversation); "json"
   * uses structured-output JSON. Default "json". Only affects the openai/codex
   * `sdk-api` path today.
   */
  decisionMode?: "tool" | "json";
  /** Optional logger. Default: JSONL-to-stderr. */
  logger?: Logger;
}

export interface ResolvedDecide {
  decide: GetNextActionFn;
  resolution: TransportResolution;
}

/**
 * Build a `GetNextActionFn` for the given provider, choosing the best available
 * transport for the current environment.
 *
 * Local environment priority: sdk-agent > cli > sdk-api.
 * Cloud environment priority: sdk-api only.
 *
 * Falls back through the chain when a transport is unavailable. Each fallback
 * is logged via `onResolve` and to stderr so degraded performance is visible.
 * If no transport resolves, throws.
 */
export function resolveTransport(options: ResolveOptions): ResolvedDecide {
  const startedAt = Date.now();
  const env = detectEnv(options.env);
  const order = transportOrder(options.provider, env, options.transport);
  const logger = options.logger ?? createDefaultLogger();

  let firstError: { transport: TransportId; reason: string } | undefined;

  for (let i = 0; i < order.length; i += 1) {
    const candidate = order[i];
    if (!candidate) continue;
    const probe = probeTransport(options, candidate, env);
    if (!probe.ok) {
      logger.warn("browser_agent.transport_unavailable", {
        provider: options.provider,
        transport: candidate,
        reason: probe.reason,
      });
      if (i === 0) firstError = { transport: candidate, reason: probe.reason };
      continue;
    }

    const decide = buildDecide(options, candidate);
    const resolution: TransportResolution = {
      provider: options.provider,
      env,
      transport: candidate,
      durationMs: Date.now() - startedAt,
      ...(firstError
        ? { fallbackFrom: firstError.transport, fallbackReason: firstError.reason }
        : {}),
    };

    emitResolved(options.onResolve, resolution, logger);
    return { decide, resolution };
  }

  throw new Error(
    `No transport available for provider=${options.provider} in env=${env}. ` +
      `Tried: ${order.join(", ")}.`,
  );
}

function transportOrder(
  provider: ProviderKind,
  env: EnvId,
  forced?: TransportId | "auto",
): TransportId[] {
  if (forced && forced !== "auto") return [forced];

  if (env === "cloud") {
    // Cloud: API-only. Local CLI/agent SDK assumes binaries + auth on disk.
    if (provider === "openai" || provider === "anthropic") return ["sdk-api"];
    if (provider === "claude") return ["sdk-api"];
    if (provider === "codex") return ["sdk-api"];
  }

  // Local: prefer agent SDK, fall back to CLI, then to raw API where it makes sense.
  if (provider === "codex") return ["sdk-agent", "cli", "sdk-api"];
  if (provider === "claude") return ["sdk-agent", "cli", "sdk-api"];
  if (provider === "openai" || provider === "anthropic") return ["sdk-api"];
  return [];
}

interface ProbeResult {
  ok: boolean;
  reason: string;
}

function probeTransport(options: ResolveOptions, transport: TransportId, env: EnvId): ProbeResult {
  if (transport === "sdk-agent") return probeSdkAgent(options);
  if (transport === "cli") {
    if (env === "cloud") return { ok: false, reason: "cli disabled in cloud env" };
    return probeCli(options.provider);
  }
  if (transport === "sdk-api") return probeSdkApi(options);
  return { ok: false, reason: `unknown transport ${transport}` };
}

function probeSdkAgent(options: ResolveOptions): ProbeResult {
  if (options.provider === "codex") {
    const home = process.env.HOME ?? "";
    const hasAuth =
      existsSync(path.join(home, ".codex", "auth.json")) ||
      existsSync(path.join(home, ".config", "codex", "auth.json"));
    if (!hasAuth) {
      return { ok: false, reason: "codex sdk-agent: no ~/.codex/auth.json" };
    }
    return { ok: true, reason: "" };
  }
  if (options.provider === "claude") {
    const home = process.env.HOME ?? "";
    // Tight probe: API key OR an actual credentials file (not just the dir).
    // ~/.claude exists for many reasons (settings, projects cache) without
    // the user being logged in, so directory-presence is a false positive.
    const hasAuth =
      existsSync(path.join(home, ".claude", ".credentials.json")) ||
      existsSync(path.join(home, ".config", "claude", ".credentials.json"));
    if (!hasAuth) {
      return {
        ok: false,
        reason: "claude sdk-agent: no ~/.claude/.credentials.json",
      };
    }
    return { ok: true, reason: "" };
  }
  return { ok: false, reason: `${options.provider} has no sdk-agent transport` };
}

function probeCli(provider: ProviderKind): ProbeResult {
  if (provider === "codex") {
    const bin = process.env.CODEX_BIN || "codex";
    if (!hasBinary(bin)) return { ok: false, reason: `codex cli: \`${bin}\` not found on PATH` };
    return { ok: true, reason: "" };
  }
  if (provider === "claude") {
    const bin = process.env.CLAUDE_BIN || "claude";
    if (!hasBinary(bin)) return { ok: false, reason: `claude cli: \`${bin}\` not found on PATH` };
    return { ok: true, reason: "" };
  }
  return { ok: false, reason: `${provider} has no cli transport` };
}

function probeSdkApi(options: ResolveOptions): ProbeResult {
  if (options.provider === "openai" || options.provider === "codex") {
    if (!options.apiKey && !process.env.OPENAI_API_KEY) {
      return { ok: false, reason: `${options.provider} sdk-api: OPENAI_API_KEY not set` };
    }
    return { ok: true, reason: "" };
  }
  if (options.provider === "anthropic" || options.provider === "claude") {
    if (!options.apiKey && !process.env.ANTHROPIC_API_KEY) {
      return { ok: false, reason: `${options.provider} sdk-api: ANTHROPIC_API_KEY not set` };
    }
    return { ok: true, reason: "" };
  }
  return { ok: false, reason: `${options.provider} has no sdk-api transport` };
}

function hasBinary(name: string): boolean {
  try {
    const result = spawnSync("which", [name], { stdio: "ignore" });
    return result.status === 0;
  } catch {
    return false;
  }
}

function buildDecide(options: ResolveOptions, transport: TransportId): GetNextActionFn {
  if (options.provider === "codex" && transport === "sdk-agent") {
    return createCodexSdkDecide({
      model: options.model,
      effort: options.effort,
      apiKey: options.apiKey,
      baseUrl: options.baseURL,
      onRaw: options.onCodexRaw,
    }) as GetNextActionFn;
  }
  if (options.provider === "codex" && transport === "cli") {
    return createCodexCliDecide({
      model: options.model,
      effort: options.effort,
      onRaw: options.onCodexRaw,
    }) as GetNextActionFn;
  }
  if (options.provider === "claude" && transport === "sdk-agent") {
    return createClaudeSdkDecide({
      model: options.model,
      apiKey: options.apiKey,
    }) as GetNextActionFn;
  }
  if (options.provider === "claude" && transport === "cli") {
    return createClaudeCliDecide({
      model: options.model,
    }) as GetNextActionFn;
  }
  if (
    (options.provider === "claude" || options.provider === "anthropic") &&
    transport === "sdk-api"
  ) {
    return createAnthropicDecide({
      model: options.model,
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    }) as GetNextActionFn;
  }
  if (
    (options.provider === "codex" || options.provider === "openai") &&
    transport === "sdk-api"
  ) {
    const adapterOptions = {
      model: options.model,
      apiKey: options.apiKey,
      baseURL: options.baseURL,
    };
    return (
      options.decisionMode === "tool"
        ? createOpenAIToolDecide(adapterOptions)
        : createOpenAIDecide(adapterOptions)
    ) as GetNextActionFn;
  }
  throw new Error(`buildDecide: no impl for provider=${options.provider} transport=${transport}`);
}

function emitResolved(
  callback: ResolveOptions["onResolve"],
  resolution: TransportResolution,
  logger: Logger,
): void {
  if (callback) {
    try {
      callback(resolution);
    } catch {
      // Don't let consumer logging break resolution.
    }
  }
  logger.info("browser_agent.transport_resolved", { ...resolution });
}
