import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

import type { AgentInput, AgentOutput } from "./decide/contracts";
import { SYSTEM_PROMPT } from "./decide/prompts";
import { buildFreeformDecisionPrompt, parseDecision } from "./decide/parseDecision";
import { spawnChildWithSignal } from "./features/spawnChild";

export interface CodexCliOptions {
  binaryPath?: string;
  model: string;
  effort?: string;
  cwd?: string;
  codexHome?: string;
  codexAuthHome?: string;
  onRaw?: (raw: string, step: number) => void;
}

// Codex CLI adapter for Agent callers (CLI/MCP/examples) that do
// not have the Codex SDK available. The explorer service uses the SDK directly
// via apps/server/src/lib/codex.ts::createCodexThread.
export function createCodexCliDecide(
  options: CodexCliOptions,
): (input: AgentInput, signal?: AbortSignal) => Promise<AgentOutput> {
  return async (input, signal) => {
    const prompt = `${SYSTEM_PROMPT}\n\n${buildFreeformDecisionPrompt(input)}`;
    const raw = await callCodex({
      binaryPath: options.binaryPath,
      model: options.model,
      prompt,
      effort: options.effort,
      cwd: options.cwd,
      codexHome: options.codexHome,
      codexAuthHome: options.codexAuthHome,
      signal,
    });
    options.onRaw?.(raw, input.step);
    return parseDecision(raw);
  };
}

function ensureCodexAuthInHome(codexHome: string, sourceHome?: string): void {
  mkdirSync(codexHome, { recursive: true });
  const homeDir = process.env.HOME;
  if (!homeDir) return;
  const normalizedSourceHome = sourceHome?.trim();
  const candidates: Array<{ src: string; dest: string }> = [
    ...(normalizedSourceHome
      ? [
          {
            src: path.join(normalizedSourceHome, "auth.json"),
            dest: path.join(codexHome, "auth.json"),
          },
          {
            src: path.join(normalizedSourceHome, "config.toml"),
            dest: path.join(codexHome, "config.toml"),
          },
        ]
      : []),
    { src: path.join(homeDir, ".codex", "auth.json"), dest: path.join(codexHome, "auth.json") },
    {
      src: path.join(homeDir, ".codex", "config.toml"),
      dest: path.join(codexHome, "config.toml"),
    },
    {
      src: path.join(homeDir, ".config", "codex", "auth.json"),
      dest: path.join(codexHome, "auth.json"),
    },
    {
      src: path.join(homeDir, ".config", "codex", "config.toml"),
      dest: path.join(codexHome, "config.toml"),
    },
  ];
  for (const { src, dest } of candidates) {
    if (!existsSync(src) || existsSync(dest)) continue;
    copyFileSync(src, dest);
  }
}

async function callCodex(request: {
  binaryPath?: string;
  model: string;
  prompt: string;
  effort?: string;
  cwd?: string;
  codexHome?: string;
  codexAuthHome?: string;
  signal?: AbortSignal;
}): Promise<string> {
  const bin = request.binaryPath?.trim() || process.env.CODEX_BIN || "codex";
  const args = [
    "exec",
    "--ephemeral",
    "-s",
    "read-only",
    "--skip-git-repo-check",
    "--model",
    request.model,
  ];
  if (request.effort) {
    args.push("--config", `model_reasoning_effort="${request.effort}"`);
  }
  args.push("-");

  if (request.codexHome) {
    ensureCodexAuthInHome(request.codexHome, request.codexAuthHome);
  }

  const { stdout, stderr, exitCode } = await spawnChildWithSignal({
    bin,
    args,
    stdin: request.prompt,
    cwd: request.cwd,
    env: request.codexHome ? { ...process.env, CODEX_HOME: request.codexHome } : undefined,
    signal: request.signal,
    label: "Codex CLI",
  });

  if (exitCode !== 0) {
    throw new Error(`Codex exited with code ${exitCode}: ${stderr}`);
  }
  return stdout;
}
