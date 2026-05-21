<div align="center">

# @peteqian/browser-agent-sdk

### Hands and eyes for your model.

TypeScript browser-automation SDK. Raw Chrome DevTools Protocol + an LLM decision loop. Domain-agnostic. The library core consumed by `@peteqian/browser-agent` (CLI + MCP).

[![npm](https://img.shields.io/npm/v/@peteqian/browser-agent-sdk.svg)](https://www.npmjs.com/package/@peteqian/browser-agent-sdk)
[![CI](https://github.com/peteqian/agent-browser/actions/workflows/ci.yml/badge.svg)](https://github.com/peteqian/agent-browser/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Types: TypeScript](https://img.shields.io/badge/types-typescript-blue.svg)](#)

</div>

---

## Why

Your model can reason, plan, write code. It can't open a tab, dismiss a cookie banner, click "Continue with Google", or scroll past a paywall. This package gives it that reach.

- **Raw CDP, no Puppeteer/Playwright in the chain.** Smaller surface, fewer fingerprints, faster startup.
- **Bring any model.** OpenAI, Anthropic, Codex CLI, Codex Agent SDK, Claude CLI, Claude Agent SDK — or your own `getNextAction`.
- **Built-in MCP server.** Drop into Claude Desktop, Cursor, or any MCP client without writing glue.
- **First-class CLI.** `browser-agent "task..."` and go.
- **Vision when it helps.** Screenshots forwarded to multimodal endpoints automatically.
- **Typed terminal output.** `done(data=...)` validated against a Zod schema.
- **Resilient loop.** Loop detection, step + decision timeouts, abort/stop control, head+tail history compaction.

## Benchmark

10 tasks across 5 categories; identical task list and judge on both sides. Different driver models. See [`bench/`](https://github.com/peteqian/agent-browser/tree/main/packages/sdk/bench) for methodology, per-task verdicts, raw bundles, and the comparison chart.

## Install

```bash
npm install @peteqian/browser-agent-sdk
# or
bun add @peteqian/browser-agent-sdk
```

Requirements: **Node ≥ 18** or **Bun ≥ 1.3** + any Chrome-based browser.

## Quickstart

```ts
import { Agent, Browser } from "@peteqian/browser-agent-sdk";

const browser = new Browser();
const agent = new Agent({
  task: "Go to example.com and report the H1 text.",
  browser,
  startUrl: "https://example.com",
});

try {
  console.log((await agent.run()).summary);
} finally {
  await browser.close();
}
```

That's it. Default provider auto-resolves to whatever's signed in locally (Codex → Claude → OpenAI/Anthropic by API key).

### Pin a provider

```ts
const agent = new Agent({
  task: "Find the top Hacker News story.",
  browser,
  startUrl: "https://news.ycombinator.com",
  llm: { provider: "openai", model: "gpt-4.1-mini" },
});
```

### Typed terminal output

```ts
import { z } from "zod";
import { Agent, Browser } from "@peteqian/browser-agent-sdk";

const Result = z.object({ heading: z.string() });

const result = await new Agent({
  task: "Report the page heading via done(data=...).",
  browser: new Browser(),
  startUrl: "https://example.com",
  outputSchema: Result,
}).run();

if (result.success) console.log(result.data?.heading);
```

### Drive the browser directly

```ts
import { Browser } from "@peteqian/browser-agent-sdk";

const browser = new Browser();
const page = await browser.newPage();
await page.goto("https://example.com");
console.log(await page.title());
await browser.close();
```

## CLI and MCP

The CLI (`browser-agent`) and MCP server (`browser-agent-mcp`) ship in the sibling runtime package `@peteqian/browser-agent` — install that package if you want the bins.

## Providers

| Flag                           | Backend                                       | Auth                                     |
| ------------------------------ | --------------------------------------------- | ---------------------------------------- |
| `--provider codex` _(default)_ | Codex Agent SDK → Codex CLI                   | `codex` signed in                        |
| `--provider claude`            | Claude Agent SDK → Claude CLI → Anthropic API | `claude` signed in / `ANTHROPIC_API_KEY` |
| `--provider openai`            | OpenAI Chat Completions                       | `OPENAI_API_KEY`                         |
| `--provider anthropic`         | Anthropic Messages                            | `ANTHROPIC_API_KEY`                      |

`--base-url` overrides the SDK base URL (OpenAI-compatible endpoints, local servers, gateways).

## Actions

The model emits actions from this catalog (full schemas in `src/actions/types.ts`):

`navigate` · `click` · `click_by` · `dblclick` · `hover` · `focus` · `focus_area` · `type` · `type_by` · `fill` · `scroll` · `wait` · `send_keys` · `press` · `keyboard_type` · `select_option` · `select_by` · `upload_file` · `wait_for_text` · `go_back` · `go_forward` · `refresh` · `new_tab` · `switch_tab` · `close_tab` · `close_browser` · `search_page` · `find_elements` · `find_by_role` · `find_by_text` · `find_by_testid` · `get_dropdown_options` · `find_text` · `screenshot` · `save_as_pdf` · `extract_content` · `eval` · `dialog_handle` · `network_har_start` · `network_har_stop` · `profiler_start` · `profiler_stop` · `done`

Add your own via `createDefaultActionRegistry()` + custom `ActionDefinition`.
See [`examples/custom-action.ts`](./examples/custom-action.ts).

## `AgentResult`

- `success` — `true` only when `reason === "completed"`.
- `reason` — branch on this in production: `completed`, `failed`, `max_steps`, `max_failures`, `loop_detected`, `aborted`, `stopped`, `step_timeout`, `decision_timeout`, `schema_violation`, `decide_error`.
- `summary` — human-readable, not for control flow.
- `data` — `TData | null`, validated against `outputSchema`.
- `steps` — iterations executed.

## Internal subpath

Anything beyond the public surface lives under `/internal` and carries **no stability guarantee**:

```ts
import { CDPClient, launchBrowser, executeAction } from "@peteqian/browser-agent-sdk/internal";
```

## Development

Repo is a Bun + Turbo monorepo — see the root `README.md` for setup.

```bash
bun install
bun run build         # turbo build (sdk + cli)
bun run typecheck
bun run test
```

SDK-only commands:

```bash
bun --cwd packages/sdk run build
bun --cwd packages/sdk run test
```

Examples in `examples/` — `bun --cwd packages/sdk run example:goto`, `example:agent`, `example:openai`, `example:typed-output`, `example:custom-action`, `example:extraction`, etc. MCP example lives in `packages/cli/examples/`.

## For AI agents

Skip this README — read [`docs/ai/`](./docs/ai/README.md) instead. It splits architecture, contracts, commands, conventions, and troubleshooting into focused files. `AGENTS.md` and `CLAUDE.md` at the root are thin pointers to the same folder.

## License

[MIT](./LICENSE) © Peter Qian
