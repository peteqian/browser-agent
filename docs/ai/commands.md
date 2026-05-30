# Commands

## Required before finishing a task

- `bun run fmt:check` — oxfmt verification (CI gate).
- `bun run lint` — oxlint (CI gate).
- `bun run typecheck` — `tsc -p tsconfig.build.json --noEmit` (CI gate).
- `bun run test` — bun test runner (CI gate).
- `bun run build` — tsup build (CI gate; required before publishing).

CI runs all five on every push to `main` / `dev` and on every PR.

## Auto-fix

- `bun run fmt` — apply oxfmt formatting.
- `bun run lint:fix` — apply oxlint auto-fixes.

## Run from source (Bun)

- `bun run dev:cli` — CLI from `bin/cli.ts`.
- `bun run dev:mcp` — MCP server from `bin/mcp.ts`.

## Run from built artifacts

- `bun run cli` — `dist/bin/cli.js` (requires prior `bun run build`).
- `bun run mcp` — `dist/bin/mcp.js`.

## Examples

- `bun run example:goto` basic navigation.
- `bun run example:agent` agent loop.
- `bun run example:simple-agent` `Agent` + `Browser` facade.
- `bun run example:typed-output` zod-validated terminal payload.
- `bun run example:openai` OpenAI provider.
- `bun run example:claude-sdk` Claude Agent SDK provider.
- `bun run example:codex-sdk` Codex SDK provider.
- `bun run example:events` event-stream consumer.
- `bun run example:extraction` page extraction.
- `bun run example:downloads` download handling.
- `bun run example:upload` file upload.
- `bun run example:storage-state` cookies + localStorage persistence.
- `bun run example:mcp` MCP client + server integration.

## Docs

- `bun run docs` — generate TypeDoc HTML.
- `bun run docs:watch` — watch mode.
