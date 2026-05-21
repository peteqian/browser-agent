# Getting started

## Install the SDK

```sh
npm install @peteqian/browser-agent-sdk
# or
bun add @peteqian/browser-agent-sdk
```

The SDK package ships:

- ESM exports for SDK use

## Install the CLI and MCP runtime

The CLI and MCP binaries ship in the sibling runtime package:

```sh
npm install -g @peteqian/browser-agent
# or run without a global install:
npx -y -p @peteqian/browser-agent browser-agent --help
```

You also need:

- A Chrome / Chromium installation on `PATH` (the agent launches it directly).
- One LLM provider configured (codex / claude / openai / anthropic).

## Provider auth

Pick one and set the matching env var (or pass a flag):

| Provider    | Auth                                                                           | Notes                                     |
| ----------- | ------------------------------------------------------------------------------ | ----------------------------------------- |
| `codex`     | `~/.codex/auth.json` (from `codex login`) **or** `OPENAI_API_KEY`              | Default. Uses Codex CLI/SDK.              |
| `claude`    | `~/.claude/.credentials.json` (from `claude login`) **or** `ANTHROPIC_API_KEY` | Falls back through agent SDK → CLI → API. |
| `openai`    | `OPENAI_API_KEY`                                                               | Chat Completions w/ structured output.    |
| `anthropic` | `ANTHROPIC_API_KEY`                                                            | Messages API w/ structured output.        |

Run `browser-agent --probe --provider <p>` to see what would resolve before doing real work.

## First run (CLI)

```sh
browser-agent "Open example.com and report the H1"
```

Defaults: `provider=codex`, `headless=true`, `maxSteps=40`.

Watch progress live with `--no-headless` and `--verbose`:

```sh
browser-agent --no-headless --verbose "Search for 'TypeScript' on google.com"
```

## First run (MCP)

In your MCP client config:

```json
{
  "mcpServers": {
    "browser-agent": {
      "command": "browser-agent-mcp"
    }
  }
}
```

Then in Claude Desktop / Cursor: ask the assistant to launch a session, navigate, and run agents. See [MCP guide](./guides/mcp.md).

## First run (SDK)

```ts
import { createDecide, runAgent } from "@peteqian/browser-agent-sdk";

const { decide, resolution } = createDecide({ provider: "codex" });

const result = await runAgent({
  task: "Open example.com and report the H1",
  decide,
  transportResolution: resolution,
  onEvent: (event) => console.log(event.type),
});

console.log(result.summary);
```

See [SDK guide](./guides/sdk.md) for typed-output, custom adapters, event streaming, and cancellation.

## Next

- [Action vocabulary](./guides/actions.md) — what the LLM is allowed to do.
- [Events](./guides/events.md) — observe the loop in real time.
- [Transports](./guides/transports.md) — how the agent picks between SDK / CLI / API.
