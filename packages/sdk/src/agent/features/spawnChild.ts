import { spawn, type ChildProcess } from "node:child_process";

export interface SpawnChildOptions {
  bin: string;
  args: string[];
  /** When set, written to stdin and stdin closed. */
  stdin?: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  /** Label used in abort error messages (e.g. "Codex CLI"). */
  label: string;
}

export interface SpawnChildResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

/**
 * Spawn a child process, write optional stdin, collect stdout+stderr, and
 * honor an AbortSignal. Throws if aborted before or during the call.
 *
 * Returns even on non-zero exit codes — callers decide how to interpret
 * the result (some may want stderr alongside the exit code).
 */
export async function spawnChildWithSignal(options: SpawnChildOptions): Promise<SpawnChildResult> {
  if (options.signal?.aborted) {
    throw new Error(`${options.label} aborted before spawn`);
  }

  const proc = spawn(options.bin, options.args, {
    stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.env ? { env: options.env } : {}),
  });

  let rejectAbort: ((error: Error) => void) | undefined;
  let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    rejectAbort = reject;
  });
  proc.once("close", () => {
    if (forceKillTimer) clearTimeout(forceKillTimer);
  });
  const onAbort = () => {
    proc.kill();
    forceKillTimer = setTimeout(() => proc.kill("SIGKILL"), 250);
    rejectAbort?.(new Error(`${options.label} aborted`));
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });

  if (options.stdin !== undefined) {
    proc.stdin!.write(options.stdin);
    proc.stdin!.end();
  }

  const stdoutPromise = collectStream(proc.stdout!);
  const stderrPromise = collectStream(proc.stderr!);

  try {
    const [stdout, stderr, exitCode] = await Promise.race([
      Promise.all([stdoutPromise, stderrPromise, waitForExit(proc)]),
      abortPromise,
    ]);
    if (options.signal?.aborted) {
      throw new Error(`${options.label} aborted`);
    }
    return { stdout, stderr, exitCode };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
  }
}

function collectStream(stream: NodeJS.ReadableStream): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

function waitForExit(proc: ChildProcess): Promise<number | null> {
  return new Promise((resolve) => {
    if (proc.exitCode !== null) {
      resolve(proc.exitCode);
      return;
    }
    proc.on("close", (code) => resolve(code ?? null));
  });
}
