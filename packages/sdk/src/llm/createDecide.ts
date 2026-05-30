import type { EnvId, TransportId, TransportResolution } from "../agent/contracts";
import { resolveTransport, type ResolvedDecide } from "./resolveTransport";
import type { Logger } from "../logger";

export type ProviderId = "codex" | "claude" | "openai" | "anthropic";

export interface CreateDecideOptions {
  provider: ProviderId;
  model?: string;
  apiKey?: string;
  baseURL?: string;
  /** Codex-only: passed as `model_reasoning_effort` to the codex binary/SDK. */
  effort?: string;
  /** Codex-only: invoked with the raw stdout for each decision. */
  onCodexRaw?: (raw: string, step: number) => void;
  /** Force the runtime environment (cloud disables local CLI/agent SDK fallbacks). */
  env?: EnvId | "auto";
  /** Force a specific transport. Default: auto fallback chain. */
  transport?: TransportId | "auto";
  /**
   * Decision encoding for API transports. "tool" = native tool-calling
   * (one action/turn, lean persistent conversation); "json" = structured
   * output. Default "json". Only affects the openai/codex `sdk-api` path.
   */
  decisionMode?: "tool" | "json";
  /** Callback fired once resolution succeeds. Use for telemetry/logging. */
  onResolve?: (resolution: TransportResolution) => void;
  /** Optional logger. Default: JSONL-to-stderr. Pass `noopLogger` to silence. */
  logger?: Logger;
}

/** Default model per provider. Single source of truth for CLI/MCP/embedders. */
const DEFAULT_MODEL: Record<ProviderId, string> = {
  codex: "gpt-5.3-codex",
  claude: "claude-sonnet-4-5",
  openai: "gpt-4.1-mini",
  anthropic: "claude-sonnet-4-5",
};

/**
 * Build a `GetNextActionFn` for the given provider, plus the transport resolution
 * that produced it. Pass `decide` to `Agent` as `getNextAction` and
 * `resolution` as `transportResolution` so consumers receive the
 * `transport_resolved` event.
 *
 * Resolves the best transport for the runtime environment (sdk-agent in
 * local, sdk-api in cloud) and falls back to lower-priority transports when
 * the preferred one is unavailable. See `resolveTransport` for the full
 * priority chain and probe checks.
 */
export function createDecide(options: CreateDecideOptions): ResolvedDecide {
  const model = options.model ?? DEFAULT_MODEL[options.provider];
  return resolveTransport({
    provider: options.provider,
    model,
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    effort: options.effort,
    onCodexRaw: options.onCodexRaw,
    env: options.env,
    transport: options.transport,
    decisionMode: options.decisionMode,
    onResolve: options.onResolve,
    logger: options.logger,
  });
}
