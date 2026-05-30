import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export type ClientId = "codex" | "claude-code" | "cursor";

export interface ClientDetection {
  id: ClientId;
  label: string;
  detected: boolean;
  reason: string;
}

function hasBin(bin: string): boolean {
  try {
    execSync(`command -v ${bin}`, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function detectClients(home: string = homedir()): ClientDetection[] {
  const codexConfig = join(home, ".codex/config.toml");
  const cursorDir = join(home, ".cursor");

  const cursorAppPath =
    platform() === "darwin"
      ? "/Applications/Cursor.app"
      : platform() === "win32"
        ? join(process.env.LOCALAPPDATA ?? "", "Programs/cursor")
        : join(home, ".config/Cursor");

  return [
    {
      id: "codex",
      label: "Codex",
      detected: existsSync(codexConfig) || hasBin("codex"),
      reason: existsSync(codexConfig)
        ? `${codexConfig} exists`
        : hasBin("codex")
          ? "codex on PATH"
          : "no codex config or binary",
    },
    {
      id: "claude-code",
      label: "Claude Code",
      detected: hasBin("claude"),
      reason: hasBin("claude") ? "claude on PATH" : "`claude` CLI not on PATH",
    },
    {
      id: "cursor",
      label: "Cursor",
      detected: existsSync(cursorDir) || existsSync(cursorAppPath),
      reason: existsSync(cursorDir)
        ? `${cursorDir} exists`
        : existsSync(cursorAppPath)
          ? `${cursorAppPath} exists`
          : "no Cursor install found",
    },
  ];
}
