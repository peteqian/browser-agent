# Architecture

## Directory map

- `src/agent/` LLM decision loop, prompts, contracts, decision adapters, `Agent` facade.
- `src/llm/` provider adapters (OpenAI, Anthropic) and transport resolution.
- `src/actions/` browser action types and execution.
- `src/browser/` `Browser` facade, sessions, profiles, runtime watchdogs.
- `src/cdp/` raw Chrome DevTools Protocol launch, discovery, WS client, Chrome args.
- `src/dom/` DOM serialization and DOM-facing types.
- `src/mcp/` MCP server integration and tool handlers.
- `bin/cli.ts` command-line entry point.
- `bin/mcp.ts` MCP server entry point.
- `examples/` runnable usage examples.

## Runtime topology

```
CLI / SDK / MCP
   │
   ▼
Agent (high-level) ──── Browser (high-level)
   │                        │
   ▼                        ▼
runAgent loop ─── BrowserSession ─── CDPClient (WS)
   │
   ▼
DecideFn / GetNextActionFn  ◄──  LLM adapter (OpenAI / Anthropic / Codex / Claude)
```

The loop builds a `DecisionInput` from `BrowserStateSummary` + history, calls the model, parses actions, executes them through the action registry against the active `Page`, captures the next state, repeats until terminal.

## Entry points

- Public surface: `src/index.ts` → published as `@peteqian/browser-agent`.
- Internal surface: `src/internal.ts` → published as `@peteqian/browser-agent/internal`. No stability guarantee.
- CLI: `bin/cli.ts` → built bin `browser-agent`.
- MCP: `bin/mcp.ts` → built bin `browser-agent-mcp`.
