# browser-agent

TypeScript browser-automation. Raw Chrome DevTools Protocol + an LLM decision loop.

This monorepo ships two npm packages:

| Package                                         | Path            | Purpose                                                                                           |
| ----------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------------- |
| [`@peteqian/browser-agent-sdk`](./packages/sdk) | `packages/sdk/` | Library core. `runTask`, `Browser`, `Page`, actions, DOM, LLM adapters. Import this in your code. |
| [`@peteqian/browser-agent`](./packages/cli)     | `packages/cli/` | CLI binary `browser-agent`, MCP server `browser-agent-mcp`, and local HTTP dashboard.             |

Library consumers depend on `-sdk`. CLI / MCP users install the unsuffixed package.

> **For AI agents (Codex, Claude Code, Cursor):** read the AI manual in
> [`packages/sdk/docs/ai/`](./packages/sdk/docs/ai/README.md) — architecture,
> contracts, commands, conventions, and troubleshooting. `packages/sdk/AGENTS.md`
> is a thin pointer to the same folder.

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

Single-task CLI invocations (`browser-agent "task..."`) launch a fresh browser per call. For workflows that need a long-lived browser session across many tool calls — the same pattern as a background daemon — use the MCP server `browser-agent-mcp`. It holds the `BrowserSession` open between tool invocations so the agent can `launch_session` once and then issue many `navigate` / `click` / `type` / `extract` calls against the same tab.

| Use case                                         | Tool                      |
| ------------------------------------------------ | ------------------------- |
| One task from a prompt                           | `browser-agent` CLI       |
| Persistent browser in Claude Code / Cursor / IDE | `browser-agent-mcp` (MCP) |

Install the MCP server into your agent host:

```bash
browser-agent install         # registers browser-agent-mcp with Claude Code / Cursor
```

Check or install the managed browser runtime:

```bash
browser-agent browser status
browser-agent browser install # installs Chrome for Testing if needed
```

Chrome for Testing is the default managed browser. It helps reproducible
automation and keeps debug-mode Chrome separate from your regular browser, but
it does not remove cookie banners by itself. Use persistent profiles plus
`autoConsent` for repeat visits where consent and login state should survive.

For local inspection while developing an automation, run the HTTP dashboard:

```bash
browser-agent dashboard       # http://127.0.0.1:3217
browser-agent dashboard status
```

The dashboard writes a small daemon manifest to `~/.browser-agent/daemon.json`
so a later CLI process can discover and health-check the running HTTP daemon.
If the dashboard was killed without a clean shutdown, `browser-agent dashboard
status` and `daemon_status` remove the stale manifest after the failed health
check.
MCP clients can use the explicit `daemon_*` tools (`daemon_status`,
`daemon_launch_session`, `daemon_list_sessions`, `daemon_attach_session`,
`daemon_get_snapshot`, `daemon_search_page`, `daemon_find_elements`,
`daemon_extract_content`, `daemon_screenshot`, `daemon_save_as_pdf`,
`daemon_list_artifacts`, `daemon_action`, `daemon_close_session`) to launch,
discover, inspect, extract, or drive sessions owned by that dashboard daemon
from a fresh MCP process.

Then the agent drives the persistent session via tool calls:

```text
launch_session  → navigate(url)  → click(selector)  → type(selector, text)  → extract(...)
                                                    ↑ same browser, no relaunch
```

Each MCP action returns the next observation and caches the latest selector
map on the daemon session. That lets the agent use the visible `@eN` refs from
one tool result in the next tool call, e.g. `click({ ref: "@e4" })`, without
calling `get_snapshot` after every action.

When several small actions do not need a page read between them, use
`run_actions` to execute up to 10 actions and return one final observation.
Example: focus a field, type text, then press Enter as a single MCP call.

For sites with autocomplete and dynamic UI, prefer webpage-native input:
`focus` / `fill` / `keyboard_type` / `press` use CDP keyboard input against
the focused element instead of constructing URL parameters.

For auth and repeat visits, launch with a named profile:
`launch_session({ profile: "booking", startUrl: "https://www.booking.com/" })`.
Named profiles store a persistent Chrome profile and storage-state file under
`~/.browser-agent/profiles/<name>/`, so cookies and localStorage survive the
next MCP session. The CLI mirrors this with `browser-agent --profile booking`.
Use `browser-agent profile list` / `show <name>` / `clear <name>` to inspect
or remove profile directories when they are no longer needed.

For sites that rely on browser fingerprint trust, use a real headed browser
surface instead of the default stealth patches. The SDK, CLI, MCP, and dashboard
launch paths support `fingerprintMode: "native"` / `--fingerprint-mode native`,
which preserves the browser's own JS-visible fingerprint and skips the
hard-coded user-agent/client-hints override. When Browser Agent owns the Chrome
process, native mode also uses only essential DevTools/profile launch flags
instead of the broader automation-tuned default arg set. Pair it with a
persistent profile or a real Chrome CDP endpoint:

```bash
browser-agent "Report the current browser fingerprint" \
  --cdp-url http://127.0.0.1:9222 \
  --fingerprint-mode native
```

Then use the `fingerprint_report` action to inspect the exposed user agent,
`navigator.webdriver`, plugins, language, screen, timezone, and WebGL values.
This makes manual challenge flows debuggable, but it is not a guarantee that a
third-party anti-bot provider will accept the session.

If the host loses the `sessionId` while the MCP daemon is still running, use
`list_sessions` to see live sessions or `attach_session({ profile: "booking" })`
to recover the current page and latest `@eN` observation.
Use `list_session_events({ sessionId })` to inspect the recent lifecycle and
action history for debugging or a dashboard view.

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
