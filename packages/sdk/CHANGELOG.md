# Changelog

## 0.2.0

### Minor Changes

- 03e53b2: Add anti-bot, observability, and job-application features.

  **Anti-bot / human-like navigation**

  - Configurable fingerprint API: `fingerprint` preset (`macos-chrome` | `windows-chrome` | `linux-chrome`) or a partial `FingerprintProfile`, with the stealth init script and `Emulation.setUserAgentOverride` generated from one resolved profile so JS- and header-visible signals stay coherent.
  - Humanized input (`humanize`): curved bezier mouse paths with jitter, eased step timing, held clicks, and variable typing cadence.
  - Bot-challenge watchdog (on by default): detects Cloudflare interstitials / Turnstile / reCAPTCHA / hCaptcha, waits for auto-pass, clicks interactive Turnstile checkboxes, and surfaces unresolved challenges as a `challenge` event + observation note. Pluggable `CaptchaSolver` interface (2captcha / CapSolver / human handoff) with site-key parse + token injection.
  - Proxy rotation (`ProxyPool`): round-robin / random / sticky-per-host, wired into `Browser` via `proxyPool`.
  - Rate limiting (`rateLimit: { perActionMs, perHostMs }`): politeness delays between actions.

  **Embedded forms (job boards)**

  - Full out-of-process iframe support: cross-origin iframe targets (Greenhouse / Workday embeds) are captured, coordinate-translated, and merged into the snapshot (`framePath: "oopif:<targetId>"`); `click` / `type` / `select_option` / `upload_file` route to the owning target. `data-automation-id` captured as a test id.
  - Applicant autofill (`planAutofill` + `ApplicantProfile` + `AnswerBank`): deterministic form fills matched by label synonyms, with a cache for free-form answers.

  **Self-healing & reliability**

  - Stale-element self-healing: re-observe, re-locate by stable identity, retry once.
  - Post-condition assertions (`postCondition`): verify `url_changed` / `element_gone` / `text_present` / … after an action and downgrade silent no-ops to failures.
  - Snapshot reuse and a login-wall watchdog.

  **Observability & CI/CD**

  - `RunReportCollector` → structured `RunReport` (steps, tokens, cost, challenges) with `toJUnitXml` and `reportToOtel` (OpenTelemetry spans + metrics, dependency-free).
  - Cost observability: per-model pricing table + `estimateCostUsd`; `budget: { maxCostUsd, maxTokens }` terminates a run with `reason: "budget_exceeded"`.
  - `TraceRecorder`: per-step screenshot + observation replay bundle with an `index.html` timeline.
  - PII redaction (`redactReport` / `redactString` / `redactValue`).

  **CLI + MCP surfacing**

  - New CLI flags: `--proxy` / `--proxy-bypass`, `--rate-limit-ms` / `--rate-limit-host-ms`, `--report-json`, `--trace-dir`, `--redact` (also accepted in `--config`).
  - MCP `run_agent` tool gains `proxy`, `proxyBypass`, `rateLimitMs`, `rateLimitHostMs`, `includeReport` (returns the `RunReport` inline), and `redact`.

## 0.1.3

### Patch Changes

- e90c518: Add examples for `fingerprintMode: "native"` — reuse signed-in browser profiles without stealth patches or `navigator.webdriver` detection.

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

## 0.1.0

### Breaking

- **This package is now `@peteqian/browser-agent-sdk`.** The library core (Page, BrowserSession, Agent, actions, internal subpath) ships under the `-sdk` name. The unsuffixed `@peteqian/browser-agent` is **not deprecated** — it is now a separate runtime package (CLI + MCP server, future HTTP API) that depends on this SDK. Library consumers move to `@peteqian/browser-agent-sdk`; CLI/MCP users still install `@peteqian/browser-agent`.
- CLI binary `browser-agent` and MCP server `browser-agent-mcp` moved out of this package into `@peteqian/browser-agent`. The `bin/` entries and `src/mcp/` directory no longer live here.
- `createMcpServer` / `runStdioServer` root re-exports removed. They now live in `@peteqian/browser-agent`.
- Removed `@modelcontextprotocol/sdk` from dependencies — runtime-only concern.
- Internal subpath path changed: `@peteqian/browser-agent/internal` → `@peteqian/browser-agent-sdk/internal`.

## Unreleased

### Breaking

- `AgentResult` now carries a `reason: TerminalReason` field. Consumers should branch on `reason` instead of pattern-matching `summary`. `success` is preserved as a boolean alias for `reason === "completed"`.
- Public exports trimmed. Implementation details (`CDPClient`, `launchBrowser`, `BrowserProfile`, `serializePage`, `formatSnapshotForLLM`, `executeAction`, `actionSchemas`, `Action`, `ActionName`, `ActionResult`, `buildDecisionPrompt`, `SYSTEM_PROMPT`, DOM types) moved to the `@peteqian/browser-agent/internal` subpath. The internal subpath has no stability guarantee.
- `DecideFn` signature changed to `(input, signal) => Promise<Decision>`. Built-in adapters forward the signal to the SDK so timed-out HTTP calls actually cancel.
- Removed job-search-specific contract types (`FoundJob`, `DistilledTrajectory`, `Extractor`, `TrajectoryStep`) and the `onFoundJobs` / `onDistilledTrajectory` callbacks. Consumers should define these locally and adopt `outputSchema` for typed terminal payloads.

### Added

- Add native browser fingerprint mode for owned Chrome launches and CDP
  attachments. Native mode skips stealth init scripts, fixed user-agent/client
  hints overrides, and broad automation-tuned Chrome default args so headed
  profile sessions can preserve the browser's real JS-visible surface.
- Add `fingerprint_report` diagnostic action for inspecting browser-exposed
  signals such as `navigator.webdriver`, user agent data, plugins, WebGL,
  screen, viewport, locale, and timezone.
- Add `Browser.kill()` and process-tree cleanup for launched Chrome sessions.
  Owned browsers now launch in a separate process group on non-Windows, use
  graceful `SIGTERM` on close, and fall back to `SIGKILL` for stuck children.
- Add CDP URL and native fingerprint options to the benchmark runner so headed
  real-browser sessions can be measured from the same harness.
- `createDecide({ provider, ... })` consolidates per-provider factory selection. Replaces duplicated switches in CLI and MCP entry points. Supported providers: `codex`, `openai`, `anthropic`.
- `AgentEvent` discriminated union and `onEvent` callback. Emits `decision`, `action`, `action_start`, `loop_nudge`, `terminal`, and other events in order. `onStep` retained as a thin shim.
- `DecisionTelemetry` and `TokenUsage` types. `Decision.telemetry` is filled by built-in OpenAI and Anthropic adapters (latency, model, token counts including cached). Codex CLI adapter leaves it undefined.
- Cancellation: full `AbortSignal` propagation. `AgentController` for cooperative pause/resume/stop. Action signal threading is best-effort (page-method calls do not all accept signals).
- Resilience layer: `stepTimeoutMs`, `decisionTimeoutMs`, `actionTimeoutMs`, `maxFailures`, `finalResponseAfterFailure`.
- Loop detection: `loopDetectionMode` (`"nudge"` default, `"strict"`, `"off"`), `loopDetectionWindow`, `loopDetectionNudgeBudget`. Nudge mode injects a stagnation notice into the next observation and escalates to a hard stop only after the budget is exhausted. Each nudge emits a `loop_nudge` event with `nudgesUsed`/`budget`.
- Multi-action failure detection: a step where every action fails increments the consecutive-failure counter (previously only single-action steps did).
- DOM snapshot: CDP `DOMSnapshot.captureSnapshot` plus `Accessibility.getFullAXTree` with a stable `SelectorMap` (index → backendNodeId). Stale lookups produce a deterministic `Element [N] no longer exists in the DOM` failure. Prompt budgets configurable via `AgentOptions.domBudgets`.
- Safer action semantics:
  - `type` accepts `mode: "replace" | "append"`, substitutes `<secret>KEY</secret>` tokens against `AgentOptions.sensitiveData` at execute time (real values never enter prompts/history/events), and verifies `.value` against expected text — surfacing a deterministic `value_mismatch` failure.
  - `click` detects `target=_blank`/popup tabs spawned by the click via `Target.attachedToTarget` and switches the loop's active page to the opener-matched tab. Bounded by `AgentOptions.newTabDetectMs` (default 500ms; 0 disables).
  - `upload_file` validates each path with `existsSync`/`statSync` before any CDP call and walks the DOM (self → descendants → ancestors up to FORM or 4 levels) to find the nearest `<input type="file">`, so models clicking a visible Upload button still hit the hidden input.
- Action registry supports `ActionDefinition.appliesTo(state)`. `describeForPrompt(state?)` and `listFor(state)` filter actions whose predicate rejects the current `BrowserStateSummary`.
- `extract_content`:
  - Classifies thrown extraction errors (`navigation_in_flight`, `timeout`, `unknown`) and returns a recoverable `ok:false` result with `data.extractionError = { reason, message }` for intelligent retry.
  - Accepts `alreadyCollected` (capped at 5000 entries); matching absolute link URLs are skipped so paginated extraction produces dedupe-clean output.
- Removed the older forced-final-turn nudge now that the loop no longer has a caller-configured iteration limit.
- `runTask(options)` is now the first-class one-shot SDK wrapper. `Agent` remains available for class-based callers, while the lower-level loop runner is no longer exported from the package root.
- Head+tail history compaction. `DecisionInput.history` now keeps the first `AgentOptions.historyHead` (default 2) plus the last `AgentOptions.historyTail` (default 8) entries with a synthetic `("...", "(N earlier steps omitted)")` marker between them, so initial-run context survives long sessions instead of falling off the back of a fixed last-N window. Wired into both the main loop and the final-failure recovery path. `compactHistory(history, head, tail)` is exported from the loop module for harnesses.
- Persistent per-run memory: `AgentOptions.memory` seeds it; `DecisionInput.memory` exposes the current value; `Decision.memory` updates it. `buildDecisionUserPrompt` includes a `Current memory:` block so all SDK adapters surface it without changes.
- Structured extraction hook: `AgentOptions.extractionLLM: ExtractionLLMFn` plus a new optional `schemaJson` param on `extract_content`. When both are present, the executor routes the extracted markdown through the hook and exposes the hook's returned data as `result.data.structured`. Hook errors surface as `result.data.structuredError` without failing the action. `schemaJson` is ignored if no hook is wired. Validation is owned by the hook — the loop does not parse the returned data.
- Optional final judge: `AgentOptions.judge: JudgeFn`. After a successful `done`, the judge receives the final `DecisionInput`, the model's summary, and validated `data`. Returning `pass: false` produces a terminal with `reason: "judge_failed"` and the judge's `reason` appended to the summary. Failures (`done` with `success: false`) skip the judge.
- MCP server resilience:
  - Per-session `lastAccessedAt` plus a `.unref()`ed sweeper closes idle sessions beyond `MCP_SESSION_TTL_MS` (default 30 min) on `MCP_SESSION_SWEEP_MS` cadence (default 10 min). `sweepIdleSessions(now?)` and `shutdownAllSessions()` exported for test harnesses and shutdown hooks.
  - Per-session artifact tracking: `screenshot` and `save_as_pdf` tool wrappers feed filesystem paths into a session-scoped artifacts list. New `list_artifacts` tool returns them in creation order, optionally filtered by `kind`. In-memory base64 screenshots are skipped.
- Integration fixture infrastructure under `src/__integration__/`: `startFixtureServer` exposes default pages (forms, hidden file inputs, OAuth-style new tabs, paginated lists); `withIntegrationContext` boots a headless `BrowserSession` against the fixture. Gated behind `BAGENT_INT=1` so the suite skips cleanly in sandboxes without Chrome.

### Public API audit

- `BrowserSession.waitForNewPageTarget` and `BrowserSession.findNearestFileInputBackendNodeId` are now part of the public surface; custom actions can lean on them for new-tab detection and upload discovery without reaching into internals.
- `JudgeFn` is exported from the public entry for callers writing custom judges.
- MCP artifact internals (`SessionArtifact`, `ArtifactKind`, `recordArtifact`, `sweepIdleSessions`, `shutdownAllSessions`) are intentionally not re-exported from `@peteqian/browser-agent`; they remain importable from `./mcp/server` for harnesses and tests but carry no stability guarantee.

### Fixed

- Multi-action failure counter no longer skips multi-action plans.
- Codex CLI subprocess is killed when the agent aborts.
