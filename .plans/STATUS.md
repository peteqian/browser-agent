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
- Layer 6: MCP session cleanup/artifacts and examples for extraction, downloads, upload, storage state, and MCP.
- Layer 7: browser integration fixture pages, local diagnostics, and privacy/redaction tests.

## Non-Goals

- Hosted browser product.
- Third-party hosted browser API integration.
- Proxy marketplace or rotation services.
- Managed CAPTCHA solving.
- Telemetry that leaves the user's machine by default.
