# Changelog

## 0.1.2

### Patch Changes

- ccf21f1: Fix eight correctness bugs found in review:
  - MCP `run_actions` now runs every action in a caller-supplied batch instead of stopping after the first state-changing one (it previously dropped the rest but reported success).
  - `extract_content` no longer rejects a second, differently-queried extraction on the same page as a duplicate.
  - The native tool-calling adapter now returns a result for every `tool_call` when a model emits several, avoiding a failed follow-up request.
  - Action parse/schema errors are now surfaced back to the model in tool-calling mode so it can correct itself.
  - Loop nudge budget is no longer double-consumed when two detectors fire in the same step.
  - Chrome version discovery sorts numerically, so the newest installed build is chosen (e.g. 140 over 99).
  - `decisionMode` is now plumbed through the SDK `runTask`/`Agent` API, not just the CLI.
  - The accessibility-tree snapshot fallback reads node DOM info in parallel instead of one CDP round-trip at a time.

  Also fixes Linux Chrome-for-Testing discovery and auto-disables the Chrome sandbox when running as root or in CI so headless launches succeed.

- Updated dependencies [ccf21f1]
  - @peteqian/browser-agent-sdk@0.1.2

## Unreleased

### Patch Changes

- Add CLI, dashboard, and MCP support for native browser fingerprint sessions
  via `--fingerprint-mode native`, `--cdp-url`, profile persistence, and
  real-browser diagnostic workflows.
- Add MCP `close_session` force cleanup. Passing `force: true` kills the owned
  browser process tree when Chrome or a child process is stuck.
- Add persistent profile management with `browser-agent profile list`, `show`,
  and `clear`.
- Add the local HTTP dashboard daemon (`browser-agent dashboard`) with
  health-checkable daemon discovery, live session inspection, action execution,
  event viewing, and artifact visibility.
- Add MCP `daemon_*` tools so fresh MCP processes can launch, attach to,
  inspect, extract from, screenshot, save PDFs from, list artifacts for, and
  close dashboard-owned sessions.

## 0.1.1

### Patch Changes

- Fix `workspace:*` dependency leaking into published tarball, which broke
  `npm`/`npx` install (`EUNSUPPORTEDPROTOCOL`). Codex / Claude Code / Cursor
  users saw `MCP startup failed: handshaking with MCP server failed:
connection closed: initialize response` because the bin never linked.

  Publish now runs through `scripts/publish.mjs` → `bun publish`, which
  rewrites `workspace:*` to the SDK's exact version.

  Add `browser-agent install` subcommand: interactive TUI that detects
  Codex / Claude Code / Cursor, prompts for scope (user vs project) and
  runtime source (npx / local checkout / global), and writes config.
  Non-interactive flags supported (`--client`, `--scope`, `--source`,
  `--name`, `--print`, `--all-detected`).

- Updated dependencies
  - @peteqian/browser-agent-sdk@0.1.1

## 0.1.0

Initial release as the runtime shell for `@peteqian/browser-agent-sdk`.

- CLI binary `browser-agent`, MCP server `browser-agent-mcp` — moved from the unsuffixed library package as part of the SDK/runtime split.
- Depends on `@peteqian/browser-agent-sdk` via `workspace:*` for the automation library.
