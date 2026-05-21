# Plan Status

Read this file first. It is the compact routing table for the deeper plan files.

## Status Legend

- `DONE`: implemented and verified. Skip unless auditing, fixing a regression, or changing the completed behavior.
- `PARTIAL`: some work is implemented, but important planned work remains. Read only the completed notes and the section relevant to the current task.
- `ACTIVE`: the recommended next area of implementation. Read before making changes in that area.
- `BACKLOG`: planned but not started. Skip unless the user explicitly asks for that feature area.
- `STABLE`: foundational direction or constraints that are not expected to change often. Read only when changing scope, non-goals, or package boundaries.
- `ROUTING`: index or sequencing material. Use it to decide which detailed file to open next.

## Current Focus

- `HIGH-VALUE-FEATURES.md`: dependency-ordered roadmap for the highest-value functionality gaps.
- `02-browser-runtime/02-watchdogs.md`: watchdog slices are complete through storage state; next runtime reliability work should be driven by concrete caller needs.
- `05-quality/01-testing-strategy.md`: add focused watchdog tests with each runtime/action feature slice.

## Done

- Terminal result shaping no longer forces generic tasks into `{ jobs: [] }`.
- `done.data` is preserved as final `AgentResult.data`.
- `AgentResult<TData>` and `AgentOptions<TData>.outputSchema` support zod-validated typed terminal output.
- Schema-enabled runs no longer cast collected job fallback data to arbitrary output types.
- CLI supports `--verbose` / `-v` JSONL diagnostics with raw model output and per-step data on stderr.
- Chrome launch polling no longer accumulates `exit` listeners while waiting for the DevTools endpoint.
- Hung actions now return failed action results via `AgentOptions.actionTimeoutMs`, preserving `onStep` diagnostics and action history.
- Hung model decisions now return deterministic failed results via `AgentOptions.decisionTimeoutMs`.
- Hung step context preparation now returns deterministic failed results via `AgentOptions.stepTimeoutMs`.
- Repeated single-action failures now stop deterministically via `AgentOptions.maxFailures`.
- Repeated failures can optionally trigger one final terminal recovery response via `AgentOptions.finalResponseAfterFailure`.
- Repeated action/page loops now stop deterministically via `AgentOptions.loopDetectionEnabled` and `AgentOptions.loopDetectionWindow`.
- Agent runs can be paused, resumed, and stopped via exported `AgentController` / `AgentControl`.
- DOM snapshot now uses CDP `DOMSnapshot.captureSnapshot` + `Accessibility.getFullAXTree` with a stable `SelectorMap` (index → backendNodeId). Actions resolve via `DOM.resolveNode` + `Runtime.callFunctionOn`, returning a deterministic "Element [N] no longer exists in the DOM" on stale lookups. Prompt budgets exposed via `AgentOptions.domBudgets`.
- `type` action accepts `mode: "replace" | "append"` (default `replace`, clears via select-all + value setter), substitutes `<secret>KEY</secret>` tokens against `AgentOptions.sensitiveData` at execute time so real values never enter prompts/history/events, and verifies the resulting `.value` against expected — surfacing a deterministic `value_mismatch` failure on divergence. Unknown placeholder keys fail before any CDP call.
- `click` action detects a `target=_blank`/popup tab spawned by the click and switches the loop's active page to it. Watcher subscribes to `Target.attachedToTarget` via `BrowserSession.waitForNewPageTarget` before the click so the event cannot be missed; `AgentOptions.newTabDetectMs` (default 500ms, 0 disables) bounds the wait. Watcher filters by `openerId` so unrelated background attachments cannot poison the result.
- `upload_file` action validates each path with `existsSync`/`statSync` before any CDP call and walks the DOM via `Page.findNearestFileInputBackendNodeId` (self → descendants → ancestors up to FORM or 4 levels) so models that click a visible Upload button still hit a hidden `<input type="file">`.
- Action registry supports `ActionDefinition.appliesTo(state)` for page-specific filtering. `describeForPrompt(state?)` and `listFor(state)` exclude actions whose predicate rejects the current `BrowserStateSummary`, so callers can scope custom actions by URL/tab count without polluting prompts on other pages.
- Integration fixture infrastructure landed under `src/__integration__/`. `startFixtureServer` exposes default HTML pages for forms, hidden file inputs, OAuth-style new tabs, and paginated lists; `withIntegrationContext` boots a headless `BrowserSession` against the fixture URL. Integration tests are gated behind `BAGENT_INT=1` so they skip cleanly in sandboxes without Chrome.
- `extract_content` action now classifies thrown extraction errors (navigation_in_flight, timeout, unknown) and returns a recoverable `ok:false` result with `data.extractionError = { reason, message }` so the loop can retry intelligently instead of treating it as a generic action failure.
- `extract_content` accepts an `alreadyCollected` param (capped at 5000 entries) that is forwarded to `extractContent`; matching absolute link URLs are skipped, so paginated extractions across many pages produce dedupe-clean output.
- On the final allowed step, the decision loop prepends a `FINAL STEP (N/N)` directive to the observation instructing the model to respond with the `done` action (success=true or false with a summary). Earlier steps see no change.
- Loop detection default flipped from hard-stop to **escalating nudges**. `AgentOptions.loopDetectionMode` defaults to `"nudge"` (inject a stagnation notice into the next observation, up to `loopDetectionNudgeBudget` times before escalating to a hard stop); `"strict"` preserves the immediate hard-stop behavior; `"off"` disables detection entirely. Each nudge fires a `loop_nudge` AgentEvent with `nudgesUsed` and `budget` fields. Legacy `loopDetectionEnabled === false` still maps to `"off"`.
- Persistent per-run memory threads through the decision loop. `AgentOptions.memory` seeds it; the loop publishes the current value as `DecisionInput.memory` and updates it whenever a `Decision` returns a new `memory` string. `buildDecisionUserPrompt` includes a `Current memory:` block so all SDK adapters surface it without changes.
- Optional final judge via `AgentOptions.judge: JudgeFn`. After the model emits a successful `done`, the judge receives the final `DecisionInput`, the model's summary, and the validated `data`; returning `pass: false` produces a terminal with `reason: "judge_failed"` and the judge's `reason` appended to the summary. Failures (`done` with `success: false`) skip the judge entirely.
- MCP server now stamps `lastAccessedAt` on each session record and runs a sweeper (interval `MCP_SESSION_SWEEP_MS`, default 10 min) that closes sessions idle beyond `MCP_SESSION_TTL_MS` (default 30 min). `sweepIdleSessions(now?)` and `shutdownAllSessions()` are exported for test harnesses and shutdown hooks; the interval is `.unref()`ed so an idle process can still exit cleanly.
- Structured extraction hook. `AgentOptions.extractionLLM: ExtractionLLMFn` plus an `extract_content` param `schemaJson` (≤8000 chars). When both are present, the executor passes the extracted markdown plus the JSON-schema text through the hook and surfaces the hook's returned data on `result.data.structured`. Hook rejections land on `result.data.structuredError` without failing the action. `schemaJson` without a hook is a no-op. Validation is owned by the hook — the loop never parses the returned data.
- Head+tail history compaction replaces the simple last-N slice on `DecisionInput.history`. `compactHistory(history, head, tail)` keeps the first `head` and last `tail` entries with a synthetic `{action:"...",result:"(N earlier steps omitted)"}` marker between them. Wired into both the main loop and the final-recovery path. New `AgentOptions.historyHead` (default 2) and `AgentOptions.historyTail` (default 8) tune the budgets; tail is floored at 1. Singular/plural marker text handled.
- Redaction property test (`src/agent/redaction.property.test.ts`) drives 30 randomized secret values through `runAgent` with a real `type` action and asserts: (a) the substituted value reached `typeByBackendNodeId`, (b) the value appears nowhere in `StepInfo`, `AgentEvent`, the next-step `DecisionInput.history`, or the final `AgentResult`, and (c) the `<secret>KEY</secret>` placeholder is preserved everywhere as proof we didn't dodge the leak check by dropping fields.
- Five runnable examples added covering the recent feature surface: `examples/extraction.ts` (chunked extract with `alreadyCollected` dedupe), `examples/downloads.ts` (in-process HTTP server + downloadsDir + `download_completed` event), `examples/upload.ts` (`findNearestFileInputBackendNodeId` + `uploadFilesByBackendNodeId` against a hidden input behind a visible button), `examples/storage-state.ts` (two-pass localStorage persistence via `storageStatePath`), and `examples/mcp.ts` (stdio client driving `launch_session` → `screenshot` → `list_artifacts`). Each gets a `bun run example:*` script.
- CLI `--verbose` now forwards every `AgentEvent` (not just codex raw output and `agent.step`) to stderr as timestamped JSONL (`{"t","event","data"}`). Composes with `--json`: JSONL events still go to stdout while verbose copies land on stderr.
- CHANGELOG.md `Unreleased` section refreshed to cover every slice landed since the last release (DOM snapshot, action safety, action filtering, fixture infra, extraction classification/dedupe, final-step nudge, loop nudges, memory, judge, MCP sweeper, MCP artifacts) and explicitly notes the public-API audit decisions for `BrowserSession.waitForNewPageTarget`, `BrowserSession.findNearestFileInputBackendNodeId`, `JudgeFn`, and the intentionally-internal MCP artifact helpers.
- MCP server tracks filesystem artifacts (screenshots, PDFs) per session. The `screenshot` and `save_as_pdf` tool wrappers feed result paths through `recordArtifact` into a per-session `artifacts` list; in-memory base64 screenshots without `data.path` are skipped. A new `list_artifacts` MCP tool returns them in creation order, optionally filtered by `kind`. `SessionArtifact`, `ArtifactKind`, and `recordArtifact` are exported for harnesses.
- Persistent dashboard daemon workflows are implemented. `browser-agent dashboard` writes a health-checkable daemon manifest, the dashboard owns long-lived sessions, and fresh MCP processes can drive those sessions through `daemon_status`, launch/list/attach, snapshot, named extraction/screenshot/PDF/artifact tools, generic action execution, events, and close.
- Dashboard inspection now includes selected-session snapshot, events, raw action execution, and artifact visibility so saved screenshots/PDFs are discoverable from the browser UI as well as MCP/API calls.
- `wait_for_condition` action. New schema entry polls a JS expression in the page until truthy or `timeoutMs` (default 10s, max 30s) elapses. Expression wrapped in a try/catch IIFE so transient navigation errors are swallowed per poll; success returns the truthy value on `result.data.value`, timeout returns a deterministic fail. Helper `waitForCondition(page, expression, timeoutMs, pollIntervalMs)` lives in `page-navigation.ts` and is exposed on `Page`. 5 unit tests cover hit-on-first, polling, timeout, expression wrapping, and swallowed-throw retries.
- Extraction boundary escaping. `escapeExtractionBoundaries` rewrites any literal `</url>`, `</query>`, or `</result>` inside extracted page text to `<-/url>` (etc., case-insensitive) before wrapping. Prevents a hostile page from closing the boundary tags and injecting tool-output-shaped instructions into the model's context. Applied to URL, query, and content fields. Covered by `packages/sdk/src/actions/handlers/extraction.test.ts`.
- Page init scripts. `BrowserProfileInit.initScripts: readonly string[]` registers each entry via `Page.addScriptToEvaluateOnNewDocument` in `enableDomains`, so the scripts run before any page script on every navigation in the session. Each entry is a raw JS source; empty/non-string entries are skipped. Defensive copy on `BrowserProfile`. Useful for auth-token injection, time mocking, or stubbing globals before page load. Covered by `packages/sdk/src/browser/init-scripts.test.ts`.
- Domain allowlist for `navigate` and `new_tab`. `AgentOptions.allowedDomains: readonly string[]` rejects out-of-allowlist URLs with a deterministic `blocked by allowedDomains policy` failure result before any CDP call. Patterns support exact host (`example.com`) and wildcard (`*.example.com`, which also matches the apex); non-http(s) URLs (`about:blank`, `file:`) bypass the check. Threaded via `HandlerContext.allowedDomains` and `ActionContext.allowedDomains`. Helper `matchesAllowedDomains` lives at `packages/sdk/src/browser/allowed-domains.ts` with unit tests covering wildcard apex, case-insensitivity, non-http schemes, and malformed URLs.

## Skip Unless Relevant

- `HIGH-VALUE-FEATURES.md`: read when choosing roadmap order or prioritizing browser-use parity gaps.
- `00-foundation/01-scope-and-boundaries.md`: stable unless changing package direction or non-goals.
- `00-foundation/02-contracts-and-configuration.md`: load when changing public contracts or options.
- `03-dom-and-actions/03-extraction-and-structured-output.md`: load when changing extraction or typed final output.
- `04-interfaces/03-public-api-and-examples.md`: load when changing exports or examples.
- `05-quality/03-rollout-sequence.md`: load when choosing the next implementation slice.

## Backlog

- Layer 1: local watchdogs are complete through navigation, crash/dead websocket, popup/dialog, downloads, permissions, and storage state.
- Layer 2: complete — CDP DOMSnapshot + accessibility tree enrichment with stable selector maps and prompt budgets is shipped. See Done.
- Layer 3: safer click/type/upload semantics, new-tab detection, coordinate scaling, and page-specific action filtering.
- Layer 4: clean markdown extraction, structure-aware chunking, schema extraction, extraction LLM hook, and pagination dedupe.
- Layer 5: loop nudges, opt-in strict loop stopping, message compaction, persistent run memory, and optional final judge.
- Layer 6: complete for MCP session cleanup/artifacts, dashboard-daemon workflows, profile inspection, and examples for extraction, downloads, upload, storage state, and MCP.
- Layer 7: browser integration fixture pages, local diagnostics, and privacy/redaction tests.

## Non-Goals

- Hosted browser product.
- Third-party hosted browser API integration.
- Proxy marketplace or rotation services.
- Managed CAPTCHA solving.
- Telemetry that leaves the user's machine by default.
