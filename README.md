# agent-browser

TypeScript browser-automation. Raw Chrome DevTools Protocol + an LLM decision loop.

This monorepo ships two npm packages:

| Package                                         | Path            | Purpose                                                                                                            |
| ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------------------------ |
| [`@peteqian/browser-agent-sdk`](./packages/sdk) | `packages/sdk/` | Library core. `Page`, `BrowserSession`, `Agent`, `runAgent`, actions, DOM, LLM adapters. Import this in your code. |
| [`@peteqian/browser-agent`](./packages/cli)     | `packages/cli/` | CLI binary `browser-agent` and MCP server `browser-agent-mcp`. Future: HTTP API server.                            |

Library consumers depend on `-sdk`. CLI / MCP users install the unsuffixed package.

## Development

```bash
bun install
bun run build       # turbo build (sdk first, then cli)
bun run typecheck
bun run test
bun run lint
bun run fmt:check
```

Per-package work:

```bash
bun --cwd packages/sdk run dev
bun --cwd packages/cli run dev:cli
bun --cwd packages/cli run dev:mcp
```

## Multi-step workflows

Single-shot CLI invocations (`browser-agent run ...`) launch a fresh browser per call. For multi-step agent loops that need a long-lived browser session across many tool calls — the same pattern as a background daemon — use the MCP server `browser-agent-mcp`. It holds the `BrowserSession` open between tool invocations so the agent can `launch_session` once and then issue many `navigate` / `click` / `type` / `extract` calls against the same tab.

| Use case                                | Tool                          |
| --------------------------------------- | ----------------------------- |
| One-off scripted task                   | `browser-agent` CLI           |
| Agent loop in Claude Code / Cursor / IDE | `browser-agent-mcp` (MCP)     |

Install the MCP server into your agent host:

```bash
browser-agent install         # registers browser-agent-mcp with Claude Code / Cursor
```

Then the agent drives the persistent session via tool calls:

```text
launch_session  → navigate(url)  → click(selector)  → type(selector, text)  → extract(...)
                                                    ↑ same browser, no relaunch
```

Close with `close_session` (or let the host shut the server down).

## Releases

[Changesets](https://github.com/changesets/changesets) drives versioning. SDK and CLI are version-linked while the SDK surface is pre-1.0.

```bash
bun run changeset           # author a changeset
bun run version-packages    # bump versions + changelogs
bun run release             # build + publish
```

## License

MIT.
