# Changelog

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
