import type { EnvId } from "../../agent/decide/contracts";

/**
 * Detect which environment the agent is running in.
 *
 * Priority:
 * 1. Explicit `BROWSER_AGENT_ENV=local|cloud` env var.
 * 2. Common cloud markers (Kubernetes, serverless platforms, CI).
 * 3. Default to `local`.
 *
 * Cloud environments cannot rely on local CLI binaries (codex, claude) being
 * installed or authenticated, so the resolver forces `sdk-api` transports
 * there and skips `sdk-agent`/`cli` fallbacks.
 */
export function detectEnv(override?: EnvId | "auto"): EnvId {
  if (override && override !== "auto") return override;

  const explicit = process.env.BROWSER_AGENT_ENV?.trim().toLowerCase();
  if (explicit === "local" || explicit === "cloud") return explicit;

  if (isCloudMarker()) return "cloud";
  return "local";
}

function isCloudMarker(): boolean {
  const env = process.env;
  if (env.KUBERNETES_SERVICE_HOST) return true;
  if (env.AWS_LAMBDA_FUNCTION_NAME) return true;
  if (env.GOOGLE_CLOUD_PROJECT && env.K_SERVICE) return true;
  if (env.VERCEL === "1") return true;
  if (env.FLY_APP_NAME) return true;
  if (env.RAILWAY_ENVIRONMENT) return true;
  return false;
}
