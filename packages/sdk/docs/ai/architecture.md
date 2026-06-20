# Architecture

## Plain-English names

Use the plain name when explaining the system, and the code name when searching
or editing files.

| Plain name             | Code name                              | What it means                                                                          |
| ---------------------- | -------------------------------------- | -------------------------------------------------------------------------------------- |
| **model request**      | `AgentInput` / `decideInput`           | The packet sent to the AI: task, page, history, tools, memory.                         |
| **model answer**       | `AgentOutput` / `decision`             | What the AI sends back: actions, done flag, summary, memory, telemetry.                |
| **ask the model**      | `runDecide(...)`                       | Calls the selected AI adapter with retry, timeout, and abort handling.                 |
| **action player**      | `step-runner.ts` / `runActions(...)`   | Validates and plays the model's actions one by one.                                    |
| **browser runner**     | `SessionRunner`                        | Owns the active page, latest page state, stale-element recovery, and action execution. |
| **page state**         | `BrowserStateSummary` / `browserState` | Structured snapshot of the page after observe.                                         |
| **page text for AI**   | `observation`                          | Compact text version of the page that the AI reads.                                    |
| **element lookup map** | `selectorMap`                          | Hidden map from model-visible index to Chrome backend node ID.                         |
| **action catalog**     | `ActionRegistry`                       | Known browser actions plus their schemas and descriptions.                             |
| **Chrome wire client** | `CDPClient`                            | WebSocket client that sends raw Chrome DevTools Protocol messages.                     |

Simple flow:

```
observe page -> build model request -> ask the model -> play the model answer
             -> run browser actions -> talk to Chrome -> observe again
```

## Directory map

- `src/agent/` the agent, layered:
  - `core/` loop and lifecycle: `agent.ts` facade, `engine.ts` loop engine, `controller.ts`, `step-runner.ts` (the action player), `step-context.ts`, `history.ts`, `recovery.ts`, `retry.ts`, `timeouts.ts`, `terminal-result.ts` (terminal-situation builders + `buildDecisionDoneResult`), `budget.ts` (`applyBudgetGuard`), `watchdog-gate.ts` (`runWatchdogs` pre-snapshot gate), `loop-guards.ts` (loop-detection orchestration + nudges), `options.ts`.
  - `decide/` model request/answer protocol shared with providers: `contracts.ts` (types), `decision-prompt.ts`, `prompts.ts`, `parseDecision.ts`.
  - `observe/` run-artifact helpers consuming the `AgentEvent` stream: `report.ts` (RunReport + JUnit), `otel.ts` (OpenTelemetry export), `trace.ts` (replay bundle), `redact.ts` (PII redaction), `emit.ts`.
  - `features/` `autofill.ts` (applicant form fills), `snapshot-reuse.ts`, `focus-state.ts`, `loop-detection.ts`, `spawnChild.ts`.
- `src/llm/` providers and transport, layered:
  - `providers/` model adapters: `openai.ts`/`openaiTools.ts`, `anthropic.ts`, and the CLI/SDK decide adapters `claudeCliDecide.ts`, `claudeSdkDecide.ts`, `codexCliDecide.ts`, `codexSdkDecide.ts`.
  - `transport/` `createDecide.ts`, `resolveTransport.ts`, `env.ts`.
  - `decision/` `decisionSchema.ts`, `types.ts`.
  - root: `pricing.ts` (model price table + `estimateCostUsd`, drives `budget`), `telemetry.ts`, `index.ts`.
- `src/actions/` browser action types and execution. Index-based handlers resolve through the element lookup map (`selectorMap`); entries carrying a `targetId` route to an out-of-process iframe session.
- `src/browser/` `Browser` facade, layered:
  - `session/` `session.ts` + `session-{handlers,helpers,reconnect,setup,types}.ts`.
  - `page/` `page.ts` + `page-{input,navigation,output,scripts}.ts`.
  - `identity/` `fingerprint.ts`, `humanize.ts`, `proxy-pool.ts`, `profile.ts`, `profile-paths.ts`.
  - `watchdogs/` `challenge.ts` (bot-protection + `CaptchaSolver`), `login-wall.ts`, `captcha.ts`.
  - root: `browser.ts`, `events.ts`, `state.ts`, `state-vault.ts`, `allowed-domains.ts`, `auto-consent.ts`, `storage-state.ts`.
- `src/runtime/` browser runner (`SessionRunner`: action execution, self-healing, rate limiting), `post-condition.ts`, `rate-limit.ts`.
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
Agent loop ─── BrowserSession ─── CDPClient (Chrome wire client)
   │
   ▼
Model adapter / GetNextActionFn  ◄──  LLM adapter (OpenAI / Anthropic / Codex / Claude)
```

The loop builds a model request (`AgentInput`) from page state (`BrowserStateSummary`) + history, asks the model, then the action player validates and plays the model answer (`AgentOutput.actions`) through the action catalog against the active `Page`. It captures the next state and repeats until terminal.

## Entry points

- Public SDK surface: `src/index.ts` → published as `@peteqian/browser-agent-sdk`.
- Internal SDK surface: `src/internal.ts` → published as `@peteqian/browser-agent-sdk/internal`. No stability guarantee.
- CLI runtime: `../cli/bin/cli.ts` → built bin `browser-agent` in `@peteqian/browser-agent`.
- MCP runtime: `../cli/bin/mcp.ts` → built bin `browser-agent-mcp` in `@peteqian/browser-agent`.
