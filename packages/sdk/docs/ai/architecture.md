# Architecture

## Directory map

- `src/agent/` LLM decision loop, prompts, contracts, decision adapters, `Agent` facade. Also the run-artifact helpers that consume the `AgentEvent` stream: `report.ts` (RunReport + JUnit), `otel.ts` (OpenTelemetry export), `trace.ts` (replay bundle), `redact.ts` (PII redaction), `autofill.ts` (applicant form fills).
- `src/llm/` provider adapters (OpenAI, Anthropic) and transport resolution. `pricing.ts` holds the model price table + `estimateCostUsd` (drives `budget` enforcement).
- `src/actions/` browser action types and execution. Index-based handlers resolve through `selectorMap`; entries carrying a `targetId` route to an out-of-process iframe session.
- `src/browser/` `Browser` facade, sessions, profiles, and watchdogs in `watchdogs/` (`challenge.ts` bot-protection + `CaptchaSolver`, `login-wall.ts`, `captcha.ts`). Also `fingerprint.ts`, `humanize.ts`, `proxy-pool.ts`.
- `src/runtime/` `SessionRunner` (action execution, self-healing, rate limiting), `post-condition.ts`, `rate-limit.ts`.
- `src/cdp/` raw Chrome DevTools Protocol launch, discovery, WS client, Chrome args.
- `src/dom/` DOM serialization and DOM-facing types. `cdp-snapshot.ts` expands cross-origin iframes (OOPIF) and tags merged elements with `crossOriginIframe` + `framePath: "oopif:<targetId>"`.
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
Agent loop ─── BrowserSession ─── CDPClient (WS)
   │
   ▼
DecideFn / GetNextActionFn  ◄──  LLM adapter (OpenAI / Anthropic / Codex / Claude)
```

The loop builds a `DecisionInput` from `BrowserStateSummary` + history, calls the model, parses actions, executes them through the action registry against the active `Page`, captures the next state, repeats until terminal.

## Entry points

- Public SDK surface: `src/index.ts` → published as `@peteqian/browser-agent-sdk`.
- Internal SDK surface: `src/internal.ts` → published as `@peteqian/browser-agent-sdk/internal`. No stability guarantee.
- CLI runtime: `../cli/bin/cli.ts` → built bin `browser-agent` in `@peteqian/browser-agent`.
- MCP runtime: `../cli/bin/mcp.ts` → built bin `browser-agent-mcp` in `@peteqian/browser-agent`.
