# Contracts

## Ownership

- `@peteqian/browser-agent-sdk` owns the browser, action, agent-loop, LLM, and
  transport contract types.
- `@peteqian/browser-agent` owns only the CLI/MCP runtime surface that wraps
  the SDK.
- If another package consumes data produced by the agent loop or replay pipeline, the shared type lives **here** and is exported from `src/index.ts`.
- Do not redefine these shapes in downstream packages.
- Keep implementation-only types local unless another package needs them.

Source of truth: `src/agent/contracts.ts`.

## Reader-friendly names

The exported type names are intentionally stable, but they are not always the
best teaching names. Use this map when explaining the contracts:

| Plain name             | Public type / code name          | Meaning                                                                  |
| ---------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| **model request**      | `AgentInput`                     | Everything the model sees before choosing the next action.               |
| **model answer**       | `AgentOutput`                    | The model's actions, done flag, summary, memory, and telemetry.          |
| **requested action**   | `AgentOutputAction`              | One raw action proposed by the model before schema validation.           |
| **model adapter**      | `GetNextActionFn`                | Function that turns a model request into a model answer.                 |
| **browser result**     | `AgentResult`                    | Final result returned to SDK/CLI/MCP callers.                            |
| **event stream**       | `AgentEvent` / `OnEventCallback` | Structured progress stream for UIs, reports, traces, and debugging.      |
| **action catalog**     | `ActionRegistry`                 | Known actions plus schemas/descriptions; exported through internal APIs. |
| **page state**         | `BrowserStateSummary`            | Structured page snapshot carried inside `AgentInput`.                    |
| **element lookup map** | `selectorMap`                    | Internal map from observed element index to Chrome backend node ID.      |

## Public types

Exported from the main entry (`@peteqian/browser-agent-sdk`):

- `AgentInput`, `AgentOutput`, `AgentOutputAction`, `GetNextActionFn`
- `StepInfo`, `AgentEvent`, `OnEventCallback`
- `AgentResult`, `TerminalReason`
- `AgentControl`, `PlanItem`
- `ProviderId`, `CreateDecideOptions`, `LLMAdapterOptions`, `TokenUsage`, `DecisionTelemetry`
- `JudgeFn`, `ExtractionLLMFn`
- `EnvId`, `TransportId`, `TransportResolution`
- `runTask`, `Agent`, `Browser`, `BrowserOptions`, `SimpleAgentOptions`, `AgentProviderOptions`
- `AgentBudget` (token/cost ceiling; adds `TerminalReason` `"budget_exceeded"`)

### Anti-bot / human-like navigation

- `FingerprintInit`, `FingerprintPreset`, `FingerprintProfile`, `ResolvedFingerprint`, `resolveFingerprint`, `buildFingerprintInitScript`, `buildUserAgentOverride`
- `HumanizeInit`, `HumanizeConfig`
- `ChallengeWatchdog`, `detectChallenge`, `challengeObservationNote`, `ChallengeWatchdogOptions`, `ChallengeEncounter`, `ChallengeDetection`, `ChallengeVendor`
- `CaptchaSolver`, `CaptchaSolveRequest`, `CaptchaSolveResult`
- `ProxyPool`, `resolveProxyLaunch`, `ProxyEntry`, `ProxyPoolOptions`, `ProxyRotationStrategy`
- `RateLimiter`, `RateLimitConfig`

### Job-application / forms

- `planAutofill`, `autofillActions`, `AnswerBank`, `ApplicantProfile`, `AutofillSuggestion`, `AutofillFieldKind`
- `ElementInfo.crossOriginIframe` (set on cross-origin iframe elements whose OOPIF content is merged into the snapshot under `framePath: "oopif:<targetId>"`)

### Observability / CI-CD

- `RunReportCollector`, `toJUnitXml`, `RunReport`, `RunReportStep`, `RunReportCollectorOptions`
- `reportToOtel`, `OtelExport`, `OtelSpan`, `OtelMetric`, `OtelSpanStatus`
- `TraceRecorder`, `renderTimelineHtml`, `TraceRecorderOptions`, `TraceManifest`
- `estimateCostUsd`, `resolveModelPricing`, `DEFAULT_MODEL_PRICING`, `ModelPricing`
- `redactString`, `redactValue`, `redactReport`, `RedactOptions`
- `checkPostCondition`, `PostCondition`, `PostConditionResult`

## Internal types (no stability guarantee)

Exported from `@peteqian/browser-agent-sdk/internal`:

- `CDPClient`, `launchBrowser`, `LaunchOptions`, `LaunchedBrowser`
- `BrowserProfile`, `BrowserProfileInit`
- `serializePage`, `formatSnapshotForLLM`, `ElementInfo`, `ElementBBox`, `PageSnapshot`
- `executeAction`, `ActionResult`, `actionSchemas`, `Action`, `ActionName`
- `buildDecisionPrompt`, `SYSTEM_PROMPT`

## `GetNextActionFn` signature

```ts
type GetNextActionFn = (input: AgentInput, signal: AbortSignal) => Promise<AgentOutput>;
```

Read this as:

```txt
model adapter(model request, abort signal) -> model answer
```

The loop passes an `AbortSignal` that fires when the per-decision timeout elapses or the run is aborted/stopped. Adapters MUST forward this signal to the underlying SDK call so timed-out work cancels instead of running orphaned. Built-in adapters (`createOpenAIDecide`, `createAnthropicDecide`, `createCodexCliDecide`, `createCodexSdkDecide`, `createClaudeCliDecide`, `createClaudeSdkDecide`) already do this. External implementations must follow the same pattern.

## Change protocol

When adding or changing a shared contract type:

1. Update `src/agent/contracts.ts` first.
2. Export from `src/index.ts` if it crosses the package boundary.
3. Update downstream imports to use `@peteqian/browser-agent-sdk`.
4. Preserve public stability unless the change is intentional and noted in `CHANGELOG.md`.
