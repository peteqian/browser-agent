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
- `02-browser-runtime/02-watchdogs.md`: watchdog slices are complete through permissions; storage state remains the next runtime reliability candidate.
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

## Skip Unless Relevant

- `HIGH-VALUE-FEATURES.md`: read when choosing roadmap order or prioritizing browser-use parity gaps.
- `00-foundation/01-scope-and-boundaries.md`: stable unless changing package direction or non-goals.
- `00-foundation/02-contracts-and-configuration.md`: load when changing public contracts or options.
- `03-dom-and-actions/03-extraction-and-structured-output.md`: load when changing extraction or typed final output.
- `04-interfaces/03-public-api-and-examples.md`: load when changing exports or examples.
- `05-quality/03-rollout-sequence.md`: load when choosing the next implementation slice.

## Backlog

- Layer 1: local watchdogs are complete through navigation, crash/dead websocket, popup/dialog, downloads, and permissions; storage state remains backlog.
- Layer 2: CDP DOMSnapshot + accessibility tree enrichment with stable selector maps and prompt budgets.
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
