# @peteqian/browser-agent

CLI and MCP server for [`@peteqian/browser-agent-sdk`](../sdk).

## Install

```bash
npm install -g @peteqian/browser-agent
```

## CLI

```bash
browser-agent "Find the top result on Hacker News and print its title."
browser-agent "..." --provider openai --model gpt-4.1-mini
browser-agent browser status
browser-agent browser install
browser-agent profile list
browser-agent dashboard
browser-agent dashboard status
browser-agent --probe --provider claude
```

Run `browser-agent --help` for the full flag list.

`browser-agent browser install` installs Playwright-managed Chromium when no
browser executable is discoverable. Cookie and login persistence is handled by
profiles (`--profile <name>`) and storage state, not by the browser binary
choice alone.

Named profiles live under `~/.browser-agent/profiles/<name>/`. Use
`browser-agent profile list`, `browser-agent profile show <name>`, and
`browser-agent profile clear <name>` to inspect or remove them.

`browser-agent dashboard` starts a local HTTP dashboard at
`http://127.0.0.1:3217`. It writes `~/.browser-agent/daemon.json` so later CLI
or MCP processes can discover and health-check the running dashboard daemon.
The dashboard owns long-lived browser sessions, shows snapshots/events/artifact
paths, and can run raw SDK actions against the selected session.

MCP clients can use the `daemon_*` tools to work with sessions owned by that
dashboard process from a fresh MCP connection: launch/list/attach sessions,
read snapshots/events/artifacts, run named extraction/screenshot/PDF tools, run
generic actions, and close sessions.

## MCP server

`browser-agent-mcp` is a stdio MCP server. Use the auto-installer or paste the
snippet for your client.

### Auto-install (recommended)

```bash
npx -y -p @peteqian/browser-agent browser-agent install
```

The TUI detects which clients you have (Codex, Claude Code, Cursor),
asks for scope (user vs project) and runtime source (npx vs local checkout
vs global install), then writes the config. Non-interactive forms:

```bash
browser-agent install --client codex,cursor
browser-agent install --client claude-code --scope project
browser-agent install --client codex --print     # print snippet only
browser-agent install --all-detected             # no prompts
```

### Manual install

**Codex** — `~/.codex/config.toml`:

```toml
[mcp_servers.browser-agent]
command = "npx"
args = ["-y", "-p", "@peteqian/browser-agent", "browser-agent-mcp"]
startup_timeout_sec = 20
```

**Claude Code**:

```bash
claude mcp add --scope user browser-agent -- npx -y -p @peteqian/browser-agent browser-agent-mcp
```

**Cursor** — `~/.cursor/mcp.json` (user) or `./.cursor/mcp.json` (project):

```json
{
  "mcpServers": {
    "browser-agent": {
      "command": "npx",
      "args": ["-y", "-p", "@peteqian/browser-agent", "browser-agent-mcp"]
    }
  }
}
```

### Troubleshooting

> `MCP startup failed: handshaking with MCP server failed: connection closed: initialize response`

You are on `@peteqian/browser-agent@0.1.0`, which shipped with an unresolved
`workspace:*` dependency that blocks `npm`/`npx` install. Upgrade to ≥ 0.1.1
(rerun `browser-agent install`, or bump the `-p @peteqian/browser-agent@latest`
arg in your config).

## Programmatic

```ts
import { createMcpServer, runStdioServer } from "@peteqian/browser-agent";
```

For library use (in-process automation), import `@peteqian/browser-agent-sdk` instead.
