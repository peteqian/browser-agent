# AI Manual — `@peteqian/browser-agent-sdk`

Canonical reference for AI agents (Codex, Claude Code, Cursor) working in this package. Humans should read the top-level [`README.md`](../../README.md) instead.

This package is a generic TypeScript browser-automation agent. Raw Chrome DevTools Protocol + an LLM decision loop. Domain-agnostic. CLI + SDK + MCP entry points.

## Read order

1. [`architecture.md`](./architecture.md) — directory map, runtime topology.
2. [`contracts.md`](./contracts.md) — public type surface, ownership rules, change protocol.
3. [`agentic-browsing-architecture.md`](./agentic-browsing-architecture.md) — Vercel `agent-browser` comparison and efficiency roadmap.
4. [`commands.md`](./commands.md) — dev/test/build commands and when to run them.
5. [`conventions.md`](./conventions.md) — editing rules, refactor guidance, what not to touch.
6. [`troubleshooting.md`](./troubleshooting.md) — Chrome/CDP/MCP failure pointers.

## Rules of engagement

- Prefer small, direct edits that preserve the package boundary.
- Run `bun run typecheck` after meaningful TypeScript edits.
- Do not redefine public contract shapes in downstream packages; import SDK
  contracts from `@peteqian/browser-agent-sdk`.
- Avoid backward-compat shims unless persisted data, shipped behavior, or explicit requirements demand them.
- The `/internal` subpath carries no stability guarantee — internal symbols may move without a minor bump.
