# Architecture

## Directory map

- `src/agent/` the agent, layered:
  - `core/` decision loop and lifecycle: `agent.ts` facade, `loop.ts` engine, `controller.ts`, `step-runner.ts`, `step-context.ts`, `history.ts`, `recovery.ts`, `retry.ts`, `timeouts.ts`, `terminal-result.ts`, `options.ts`.
  - `decide/` decision protocol shared with providers: `contracts.ts` (types), `decision-prompt.ts`, `prompts.ts`, `parseDecision.ts`.
  - `observe/` run-artifact helpers consuming the `AgentEvent` stream: `report.ts` (RunReport + JUnit), `otel.ts` (OpenTelemetry export), `trace.ts` (replay bundle), `redact.ts` (PII redaction), `emit.ts`.
  - `features/` `autofill.ts` (applicant form fills), `snapshot-reuse.ts`, `focus-state.ts`, `loop-detection.ts`, `spawnChild.ts`.
- `src/llm/` providers and transport, layered:
  - `providers/` model adapters: `openai.ts`/`openaiTools.ts`, `anthropic.ts`, and the CLI/SDK decide adapters `claudeCliDecide.ts`, `claudeSdkDecide.ts`, `codexCliDecide.ts`, `codexSdkDecide.ts`.
  - `transport/` `createDecide.ts`, `resolveTransport.ts`, `env.ts`.
  - `decision/` `decisionSchema.ts`, `types.ts`.
  - root: `pricing.ts` (model price table + `estimateCostUsd`, drives `budget`), `telemetry.ts`, `index.ts`.
- `src/actions/` browser action types and execution. Index-based handlers resolve through `selectorMap`; entries carrying a `targetId` route to an out-of-process iframe session.
- `src/browser/` `Browser` facade, layered:
  - `session/` `session.ts` + `session-{handlers,helpers,reconnect,setup,types}.ts`.
  - `page/` `page.ts` + `page-{input,navigation,output,scripts}.ts`.
  - `identity/` `fingerprint.ts`, `humanize.ts`, `proxy-pool.ts`, `profile.ts`, `profile-paths.ts`.
  - `watchdogs/` `challenge.ts` (bot-protection + `CaptchaSolver`), `login-wall.ts`, `captcha.ts`.
  - root: `browser.ts`, `events.ts`, `state.ts`, `state-vault.ts`, `allowed-domains.ts`, `auto-consent.ts`, `storage-state.ts`.
- `src/runtime/` `SessionRunner` (action execution, self-healing, rate limiting), `post-condition.ts`, `rate-limit.ts`.
- `src/cdp/` raw Chrome DevTools Protocol launch, discovery, WS client, Chrome args.
- `src/dom/` DOM serialization and DOM-facing types. `cdp-snapshot.ts` expands cross-origin iframes (OOPIF) and tags merged elements with `crossOriginIframe` + `framePath: "oopif:<targetId>"`.
- MCP server integration and tool handlers live in `packages/cli` (`bin/mcp.ts`), not the SDK.
- `../cli/bin/cli.ts` command-line entry point.
- `../cli/bin/mcp.ts` MCP server entry point.
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
