# High-Value Feature Roadmap

Status: ROUTING. Read after `STATUS.md` when choosing work that should most improve real-world browser-agent capability.

## Dependency Rule

Implement lower layers before higher layers. Later features should depend on stable browser state, stable element identity, and observable action results instead of adding parallel mechanisms.

## Layer 0: Keep Scope Small

Goal: Preserve the package as a local-first TypeScript browser automation core.

- Keep raw CDP as the runtime boundary.
- Avoid hosted browser, proxy marketplace, managed CAPTCHA, and external telemetry features.
- Prefer narrow public contracts over compatibility shims.
- Add feature flags/options only when a caller needs to control shipped behavior.

Depends on: nothing.

Detailed plans:

- `00-foundation/01-scope-and-boundaries.md`
- `00-foundation/02-contracts-and-configuration.md`

## Layer 1: Browser Runtime Reliability

Goal: Make browser sessions survive common local failures before improving agent intelligence.

Highest-value features:

- Crash/dead-websocket detection with deterministic failed events.
- Navigation watchdog for stalled loads, empty pages, and network-idle waits.
- Popup/dialog policy that records closed popup messages in browser state.
- Download detection with downloaded file paths surfaced in action results.
- Storage state save/restore for cookies and local/session storage.
- Permission grants from profile/config.

Depends on: Layer 0 contracts and local session lifecycle.

Detailed plans:

- `02-browser-runtime/01-local-session-lifecycle.md`
- `02-browser-runtime/02-watchdogs.md`
- `02-browser-runtime/03-artifacts.md`

Why first: DOM and action improvements are hard to verify if tabs, navigation, downloads, and session recovery are unreliable.

## Layer 2: DOM Snapshot And Element Identity — DONE

Goal: Give the model a trustworthy, bounded view of the page and make indexed actions map back to the same snapshot.

Status: complete. Implemented in `src/dom/cdp-snapshot.ts`, threaded through `BrowserStateSummary.selectorMap` and `AgentOptions.domBudgets`. Action dispatch resolves via `DOM.resolveNode` + `Runtime.callFunctionOn`; stale lookups surface `"Element [N] no longer exists in the DOM"`.

Highest-value features:

- CDP `DOMSnapshot` enrichment for bounds, visibility, computed styles, and paint order.
- Accessibility tree names/roles for better element labels.
- Selector map owned by each captured browser state.
- CSS-pixel coordinate normalization.
- Scroll container and iframe/shadow-root summaries.
- Prompt budgets for total elements, text length, attributes, and hidden iframe hints.

Depends on: Layer 1 stable session and state capture.

Detailed plans:

- `03-dom-and-actions/01-dom-snapshot-enrichment.md`

Why second: most action quality depends on correctly detecting, labeling, and targeting page elements.

## Layer 3: Action Semantics And Safety

Goal: Upgrade built-in actions from simple DOM calls to browser-grade interactions.

Highest-value features:

- Click by selector-map node with fallback to CDP coordinates when DOM `click()` is insufficient.
- Detect newly opened tabs after click and optionally switch active page.
- Type action with clear/append mode, actual-value verification, autocomplete hints, and sensitive-value redaction.
- Upload action that validates local files and can find nearby/closest file inputs.
- Coordinate scaling from model screenshot dimensions to viewport dimensions.
- Page-specific action filtering so unavailable actions do not appear in the prompt.

Depends on: Layer 2 selector map and element metadata.

Detailed plans:

- `03-dom-and-actions/02-action-registry.md`

Why third: richer action behavior needs stable DOM metadata and runtime events.

## Layer 4: Extraction And Structured Data

Goal: Make data extraction useful on long, noisy, real-world pages.

Highest-value features:

- Clean markdown extraction with link/image options.
- Structure-aware chunking with continuation offsets and overlap context.
- Optional extraction schema distinct from terminal `done.data` schema.
- Optional extraction LLM hook for structured extraction.
- `alreadyCollected` support for pagination/deduplication.
- Artifact/file integration for saved extraction outputs.

Depends on: Layer 2 page understanding and Layer 3 action/artifact results.

Detailed plans:

- `03-dom-and-actions/03-extraction-and-structured-output.md`
- `02-browser-runtime/03-artifacts.md`

Why fourth: extraction quality is bounded by DOM quality and artifact handling.

## Layer 5: Agent Memory, Loop Nudges, And Final Validation

Goal: Improve decision quality without masking runtime/action bugs.

Highest-value features:

- Replace hard loop termination as the default with escalating loop/stagnation nudges.
- Keep hard loop termination available as an opt-in strict guard.
- Message compaction for long runs.
- Persistent per-run memory surfaced in prompts and events.
- Optional final judge with caller-provided criteria.
- Better max-step finalization that forces only `done` on the last step.

Depends on: Layers 1-4 producing reliable observations and action histories.

Detailed plans:

- `01-agent-loop/02-planning-memory-and-compaction.md`
- `01-agent-loop/03-loop-detection-and-judge.md`

Why fifth: smarter prompts are most valuable after observations and actions are trustworthy.

## Layer 6: Interfaces And Operations

Goal: Expose reliable runtime features through CLI, MCP, examples, and public APIs.

Highest-value features:

- MCP session cleanup/timeouts and artifact listing.
- CLI direct browser commands for state/click/type/screenshot on persistent local sessions only if there is demand.
- Examples for typed output, extraction, downloads, file upload, storage state, and MCP.
- Public exports for stable contract types only.

Depends on: Layers 1-5 stable enough to document.

Detailed plans:

- `04-interfaces/01-cli.md`
- `04-interfaces/02-mcp.md`
- `04-interfaces/03-public-api-and-examples.md`

## Layer 7: Tests, Observability, And Rollout

Goal: Make browser behavior safe to change.

Highest-value features:

- Browser integration tests for navigation, tabs, click/type/select/upload/download, screenshots, PDFs, and action timeouts.
- Fixture pages for iframes, shadow DOM, overlays, forms, autocomplete, downloads, and long extraction pages.
- Local JSONL diagnostics for browser events, action timing, DOM snapshot counts, token usage, and artifact paths.
- Privacy rules that redact typed sensitive values and never emit telemetry off-machine by default.

Depends on: every feature layer being implemented in thin slices with verifiable behavior.

Detailed plans:

- `05-quality/01-testing-strategy.md`
- `05-quality/02-observability-and-privacy.md`
- `05-quality/03-rollout-sequence.md`

## Recommended Next Slice

Start with Layer 1 plus the minimum Layer 7 tests:

1. Add a navigation watchdog that reports stalled/empty-page state without crashing the loop.
2. Add a small fixture-page integration test for navigation success, empty-page warning, and timeout behavior.
3. Surface watchdog events through existing `browser_event` and action result shapes before adding new public contracts.

This creates the reliability base needed for DOM, action, and extraction upgrades.
