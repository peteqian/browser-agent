# @browser-agent/core

TypeScript browser automation agent using raw Chrome DevTools Protocol plus an LLM decision loop, inspired by `browser-use`.

## Quick AI Manual

AI agents should read `AGENTS.md` first. `CLAUDE.md` is a symlink to the same file.

That file is the canonical AI manual for contract ownership, architecture, and editing rules in this package.

## Quick Human Manual

Use this package when you need browser automation that can inspect pages, choose actions, execute them through CDP, and expose the workflow through a CLI or MCP server.

Common commands:

- `bun run typecheck` checks TypeScript without emitting files.
- `bun run build` compiles the package to `dist/` (required before publishing or running the production CLI).
- `bun run cli` runs the compiled browser-agent CLI.
- `bun run mcp` runs the compiled MCP server.
- `bun run dev:cli` runs the CLI directly from source (requires Bun).
- `bun run dev:mcp` runs the MCP server directly from source (requires Bun).
- `bun run example:goto` runs the basic navigation example.
- `bun run example:agent` runs the agent loop example.
- `bun run example:typed-output` runs an agent example with zod-validated terminal data.
- `bun run example:openai` runs the agent loop against the OpenAI provider.
- Add `--verbose` to `bun run cli -- ...` or `browser-agent ...` to print JSONL diagnostics, including raw model output, to stderr.

Providers:

- `--provider codex` (default) — OpenAI Codex CLI via `CODEX_BIN`.
- `--provider openai` — OpenAI Chat Completions API. Set `OPENAI_API_KEY` in env (preferred over `--api-key`, which appears in process listings).
- `--provider anthropic` — Anthropic Messages API. Set `ANTHROPIC_API_KEY` in env.
- `--base-url` overrides the SDK base URL (e.g., for compatible providers or local servers).
- `--model <id>` overrides the per-provider default model.

Main entry points:

- `dist/src/index.js` public package exports (compiled from `src/index.ts`).
- `dist/bin/cli.js` command-line entry point.
- `dist/bin/mcp.js` MCP server entry point.
- `examples/` runnable usage examples.

Typed terminal output:

```ts
import { z } from "zod";
import { runAgent, createDecide } from "@browser-agent/core";

const Result = z.object({ heading: z.string() });

const result = await runAgent({
  task: "Report the page heading via done(data=...).",
  outputSchema: Result,
  startUrl: "https://example.com",
  decide: createDecide({ provider: "openai" }),
  onEvent: (event) => {
    if (event.type === "decision" && event.decision.telemetry?.usage) {
      console.log("tokens:", event.decision.telemetry.usage);
    }
  },
});

if (result.success) {
  console.log(result.data?.heading);
} else {
  console.error(result.reason, result.summary);
}
```

`AgentResult` reference:

- `success: boolean` — convenience flag, true only when `reason === "completed"`.
- `reason: TerminalReason` — branch on this in production code:
  - `"completed"` / `"failed"` — model emitted `done(success=true|false)`.
  - `"max_steps"` — step budget exhausted.
  - `"max_failures"` — consecutive failure cap hit.
  - `"loop_detected"` — identical fingerprint window.
  - `"aborted"` / `"stopped"` — caller-initiated cancellation.
  - `"step_timeout"` / `"decision_timeout"` — per-step or per-decision timeout.
  - `"schema_violation"` — `done(data=...)` failed `outputSchema` validation.
  - `"decide_error"` — adapter threw something other than a timeout.
- `summary: string` — human-readable. Do not pattern-match for control flow.
- `data: TData | null` — validated terminal payload.
- `steps: number` — loop iterations executed.

Action catalog (model emits these via `decision.actions`): `navigate`, `click`, `type`, `scroll`, `wait`, `send_keys`, `select_option`, `upload_file`, `wait_for_text`, `go_back`, `go_forward`, `refresh`, `new_tab`, `switch_tab`, `close_tab`, `search_page`, `find_elements`, `get_dropdown_options`, `find_text`, `screenshot`, `save_as_pdf`, `extract_content`, `done`. Schemas in `src/actions/types.ts`.

Internal exports (no stability guarantee):

```ts
import { CDPClient, launchBrowser, executeAction } from "@browser-agent/core/internal";
```

Troubleshooting:

- If Chrome/CDP connection fails, check the launch/discovery code in `src/cdp/` and confirm a compatible Chrome process can start.
- If MCP startup fails, check `src/mcp/server.ts` and the `browser-agent-mcp` bin entry.
- If contract imports fail in another package, import shared types from `@browser-agent/core` instead of redefining them locally.
- After code changes, run `bun run typecheck` before handing work off.

## Compatibility

- Runtime: **Node ≥ 18** or **Bun ≥ 1.3**.
- Browser: any Chrome-based browser exposing the DevTools Protocol; tested against current stable Chrome.

## Development Notes

- Package name: `@browser-agent/core`
- Package type: ESM
- Package status: publishable (run `bun run build` before `npm publish`)
- Primary dependencies: `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `devtools-protocol`, `openai`, `ws`, `zod`
