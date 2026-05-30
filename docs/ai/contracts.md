# Contracts

## Ownership

- `@peteqian/browser-agent` owns all server-facing browser-agent contract types.
- If another package consumes data produced by the agent loop or replay pipeline, the shared type lives **here** and is exported from `src/index.ts`.
- Do not redefine these shapes in downstream packages.
- Keep implementation-only types local unless another package needs them.

Source of truth: `src/agent/contracts.ts`.

## Public types

Exported from the main entry (`@peteqian/browser-agent`):

- `AgentInput`, `AgentOutput`, `AgentOutputAction`, `GetNextActionFn`
- `StepInfo`, `AgentEvent`, `OnEventCallback`
- `AgentResult`, `TerminalReason`
- `AgentOptions`, `AgentControl`, `PlanItem`
- `ProviderId`, `CreateDecideOptions`, `LLMAdapterOptions`, `TokenUsage`, `DecisionTelemetry`
- `JudgeFn`, `ExtractionLLMFn`
- `EnvId`, `TransportId`, `TransportResolution`
- `Agent`, `Browser` (facade classes), `BrowserOptions`, `SimpleAgentOptions`, `AgentProviderOptions`

## Internal types (no stability guarantee)

Exported from `@peteqian/browser-agent/internal`:

- `CDPClient`, `launchBrowser`, `LaunchOptions`, `LaunchedBrowser`
- `BrowserProfile`, `BrowserProfileInit`
- `serializePage`, `formatSnapshotForLLM`, `ElementInfo`, `ElementBBox`, `PageSnapshot`
- `executeAction`, `ActionResult`, `actionSchemas`, `Action`, `ActionName`
- `buildDecisionPrompt`, `SYSTEM_PROMPT`

## `GetNextActionFn` signature

```ts
type GetNextActionFn = (input: AgentInput, signal: AbortSignal) => Promise<AgentOutput>;
```

The loop passes an `AbortSignal` that fires when the per-decision timeout elapses or the run is aborted/stopped. Adapters MUST forward this signal to the underlying SDK call so timed-out work cancels instead of running orphaned. Built-in adapters (`createOpenAIDecide`, `createAnthropicDecide`, `createCodexCliDecide`, `createCodexSdkDecide`, `createClaudeCliDecide`, `createClaudeSdkDecide`) already do this. External implementations must follow the same pattern.

## Change protocol

When adding or changing a shared contract type:

1. Update `src/agent/contracts.ts` first.
2. Export from `src/index.ts` if it crosses the package boundary.
3. Update downstream imports to use `@peteqian/browser-agent`.
4. Preserve public stability unless the change is intentional and noted in `CHANGELOG.md`.
