# @peteqian/browser-agent-sdk

A TypeScript browser-automation agent. Drives Chrome via raw Chrome DevTools Protocol, asks an LLM what to do at each step, executes the chosen action.

Three integration surfaces, one core:

- **CLI** — single binary, runs a task end-to-end. See [CLI guide](./guides/cli.md).
- **MCP server** — exposes tools to MCP clients (Claude Desktop, Cursor, etc.). See [MCP guide](./guides/mcp.md).
- **SDK** — `import` the package into your own Node.js / TypeScript code. See [SDK guide](./guides/sdk.md).

## What it does

You give the agent a task in natural language and (optionally) a starting URL. It opens a browser, takes a structured snapshot of the page, asks an LLM which named action to run from a fixed vocabulary (click, type, scroll, …), executes it, snapshots again, repeats until the LLM emits `done` or limits are hit.

```
[task: "find pricing on stripe.com"]
            │
            ▼
   open Chrome (CDP)
            │
            ▼
   page state + page text
            │
            ▼
   model request ──► ask model ──► model answer { actions }
                                            │
                                            ▼
                                  action player validates
                                            │
                                            ▼
                                  browser runner executes
                                            │
                                            └── back to page state
```

The browser is real Chrome (headed or headless), not a synthetic emulator.

Docs use these reader-friendly names:

| Plain name         | Code name                            |
| ------------------ | ------------------------------------ |
| model request      | `AgentInput` / `decideInput`         |
| model answer       | `AgentOutput` / `decision`           |
| ask model          | `runDecide(...)`                     |
| action player      | `step-runner.ts` / `runActions(...)` |
| browser runner     | `SessionRunner`                      |
| element lookup map | `selectorMap`                        |

## Quick links

- [Getting started](./getting-started.md)
- [Action vocabulary](./guides/actions.md)
- [Transport resolution](./guides/transports.md)
- [Event stream](./guides/events.md)
- [Errors and recovery](./guides/errors.md)
- API reference: [`api/`](./api/index.html) (generated)

## Status

Pre-1.0. Public types in `src/index.ts` are stable in spirit; internals under `@peteqian/browser-agent-sdk/internal` may change without a minor bump.
