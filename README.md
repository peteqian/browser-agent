# @peteqian/browser-agent

TypeScript browser automation agent using raw Chrome DevTools Protocol plus an LLM decision loop.

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
- Add `--tui` to `browser-agent ...` to run the Ink terminal dashboard with live browser state, plan, actions, and pause/resume controls.

Providers:

- `--provider codex` (default) — Codex Agent SDK when authenticated, falling back to Codex CLI.
- `--provider claude` — Claude Agent SDK when authenticated, falling back to Claude CLI, then Anthropic API.
- `--provider openai` — OpenAI Chat Completions API. Set `OPENAI_API_KEY` in env (preferred over `--api-key`, which appears in process listings).
- `--provider anthropic` — Anthropic Messages API. Set `ANTHROPIC_API_KEY` in env.
- `--base-url` overrides the SDK base URL (e.g., for compatible providers or local servers).
- `--model <id>` overrides the per-provider default model.

Vision, planning, and actions:

- `runAgent()` captures a first-class `BrowserStateSummary` each step: DOM observation text, indexed elements, tabs, URL/title, viewport, pending requests, and an optional PNG screenshot.
- Vision defaults to `auto`. OpenAI and Anthropic API transports receive screenshots as native multimodal input when available; CLI and agent-SDK transports fall back to text state.
- Decisions may include `memory`, `evaluationPreviousGoal`, `nextGoal`, and `plan`. These are surfaced through `planning` events and the TUI.
- Actions are resolved through an `ActionRegistry`. Use `createDefaultActionRegistry()` for built-ins, or pass custom `actions` to `runAgent()`.

Simple agent usage:

```ts
import { Agent, Browser } from "@peteqian/browser-agent";

const browser = new Browser();
const agent = new Agent({
  task: "Go to example.com and report the H1 text.",
  browser,
  startUrl: "https://example.com",
});

try {
  const result = await agent.run();
  console.log(result.summary);
} finally {
  await browser.close();
}
```

Choose a provider only when the default is not what you want:

```ts
const browser = new Browser();
const agent = new Agent({
  task: "Find the top Hacker News story.",
  browser,
  startUrl: "https://news.ycombinator.com",
  llm: {
    provider: "openai",
    model: "gpt-4.1-mini",
  },
});
```

Direct browser usage:

```ts
import { Browser } from "@peteqian/browser-agent";

const browser = new Browser();

try {
  const page = await browser.newPage();
  await page.goto("https://example.com");
  console.log(await page.title());
} finally {
  await browser.close();
}
```

Browsers run headless by default. Pass `headless: false` only when you want to see the window:

```ts
const browser = new Browser({ headless: false });
```

Lower-level agent usage:

- Use `Browser` and `Agent` for normal task automation.
- Use direct option names on `Agent`: `llm`, `browser`, `tools`, `outputModelSchema`, `useVision`, `maxFailures`, and `llmTimeout`.
- `llm` defaults to `"auto"`: it tries Codex and Claude local SDK/CLI transports first, then falls back to API-key providers when available.
- Set `llm: "codex"`, `llm: "claude"`, `llm: "openai"`, or `llm: "anthropic"` to force the provider.
- Use `getNextAction` only when you want to provide your own function that returns an `AgentOutput`.
- Use `runAgent()` when you need to provide your own `decide` function, custom transport resolution, or externally managed browser session.
- Use `BrowserSession` when you want direct CDP-backed session control without the simple facade.

Main entry points:

- `dist/src/index.js` public package exports (compiled from `src/index.ts`).
- `dist/bin/cli.js` command-line entry point.
- `dist/bin/mcp.js` MCP server entry point.
- `examples/` runnable usage examples.

Typed terminal output:

```ts
import { z } from "zod";
import { runAgent, createDecide } from "@peteqian/browser-agent";

const Result = z.object({ heading: z.string() });
const { decide, resolution } = createDecide({ provider: "openai" });

const result = await runAgent({
  task: "Report the page heading via done(data=...).",
  outputSchema: Result,
  startUrl: "https://example.com",
  decide,
  transportResolution: resolution,
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

Action catalog (model emits these via `decision.actions`): `navigate`, `click`, `type`, `scroll`, `wait`, `send_keys`, `select_option`, `upload_file`, `wait_for_text`, `go_back`, `go_forward`, `refresh`, `new_tab`, `switch_tab`, `close_tab`, `close_browser`, `search_page`, `find_elements`, `get_dropdown_options`, `find_text`, `screenshot`, `save_as_pdf`, `extract_content`, `done`. Schemas in `src/actions/types.ts`.

Internal exports (no stability guarantee):

```ts
import { CDPClient, launchBrowser, executeAction } from "@peteqian/browser-agent/internal";
```

Troubleshooting:

- If Chrome/CDP connection fails, check the launch/discovery code in `src/cdp/` and confirm a compatible Chrome process can start.
- If MCP startup fails, check `src/mcp/server.ts` and the `browser-agent-mcp` bin entry.
- If contract imports fail in another package, import shared types from `@peteqian/browser-agent` instead of redefining them locally.
- After code changes, run `bun run typecheck` before handing work off.

## Compatibility

- Runtime: **Node ≥ 18** or **Bun ≥ 1.3**.
- Browser: any Chrome-based browser exposing the DevTools Protocol; tested against current stable Chrome.

## Development Notes

- Package name: `@peteqian/browser-agent`
- Package type: ESM
- Package status: publishable (run `bun run build` before `npm publish`)
- Primary dependencies: `@anthropic-ai/claude-agent-sdk`, `@anthropic-ai/sdk`, `@modelcontextprotocol/sdk`, `@openai/codex-sdk`, `devtools-protocol`, `openai`, `ws`, `zod`
