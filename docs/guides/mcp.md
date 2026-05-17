# MCP guide

The package ships an MCP stdio server that exposes browser primitives plus a `run_agent` tool.

## Install in a client

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "browser-agent": {
      "command": "browser-agent-mcp"
    }
  }
}
```

### Cursor / Continue / other MCP clients

Same shape — point to the `browser-agent-mcp` binary or `node /path/to/dist/bin/mcp.js`.

## Tool surface

Two layers:

1. **Session-level primitives** — `launch_session`, `close_session`, `new_tab`, `switch_tab`, `list_tabs`, plus per-action tools (`navigate`, `click`, `type`, `scroll`, ...). These give the AI client direct CDP-level control.
2. **`run_agent`** — gives the AI a high-level "do this task" knob; the agent loop runs internally.

### Sessions

`launch_session` returns a `sessionId`. Pass that to every subsequent primitive call. Sessions persist across tool calls (intentional — the AI client owns lifecycle). Call `close_session` to release the browser.

### `run_agent`

```json
{
  "task": "Find top 5 frontend jobs on seek.com.au",
  "startUrl": "https://seek.com.au",
  "provider": "codex",
  "maxSteps": 30,
  "headless": true
}
```

Returns the full `AgentResult` JSON.

## Live progress

If the MCP client passes a `progressToken` in `_meta` (Claude Desktop and Cursor do this for long-running tools), `run_agent` streams `notifications/progress` for every:

- `transport_resolved` — early signal: `"transport=sdk-agent (codex/local)"`
- `decision` — `"step N: decided <action_name>"`
- `action` — `"<action_name>: ok"` / `"<action_name>: failed"`
- `terminal` — `"done: <summary>"` / `"failed: <reason>"`

Progress is monotonic (uses step number + half-steps for action vs decision). Total = `maxSteps`.

If the client does not send a progressToken, no progress events fire (avoids needless overhead).

## Cancellation

If the MCP client cancels the request, the harness aborts `extra.signal`, which propagates into the agent loop. The browser session is cleaned up if the loop owned it (`run_agent` always owns its session).

## Auth

Credentials come from env vars or local CLI auth files (same as the CLI). The MCP server does not expose its own auth flow.

## Customizing

If you embed the MCP server in your own process, use:

```ts
import { createMcpServer, runStdioServer } from "@peteqian/browser-agent";

// Plain stdio:
await runStdioServer();

// Custom transport:
const server = createMcpServer();
await server.connect(yourTransport);
```
