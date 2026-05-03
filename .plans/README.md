# Browser Agent Expansion Plans

This directory captures an ordered roadmap for expanding `@browser-agent/core` while keeping this package local-first and TypeScript-focused.

Numbered paths define order of precedence. Lower numbers are more foundational and should be completed before higher-numbered feature layers depend on them.

## Non-Goals

- No hosted cloud browser product.
- No third-party hosted browser API integration.
- No proxy rotation, CAPTCHA solving service, or hosted stealth infrastructure.
- No broad provider matrix unless there is a concrete consumer need.
- No compatibility shims for unshipped APIs.

## Plan Order

- `STATUS.md`: read this first. It says what is done, what is active, and which deeper files can be skipped.
- `00-foundation/`: package boundaries, contracts, configuration, and principles.
- `01-agent-loop/`: planning, memory, message compaction, judging, and loop detection.
- `02-browser-runtime/`: local browser sessions, watchdogs, lifecycle resilience, storage, downloads, and recording.
- `03-dom-and-actions/`: DOM snapshots, action registry, page-specific tools, extraction, and structured outputs.
- `04-interfaces/`: CLI, MCP, examples, and public API ergonomics.
- `05-quality/`: testing, observability, performance, and rollout criteria.

## Implementation Rule

Treat these files as sequencing guidance, not a mandate to implement large rewrites. Prefer the smallest correct change that advances the current numbered layer.

## AI Reading Rule

Read `STATUS.md` first. If a section is marked `DONE`, do not load the detailed plan file unless you are auditing or changing that completed work. If a section is marked `BACKLOG`, only load it when the current task explicitly touches that area.

## Status Legend

- `DONE`: implemented and verified. Skip unless auditing, fixing a regression, or changing the completed behavior.
- `PARTIAL`: some work is implemented, but important planned work remains. Read only the completed notes and the section relevant to the current task.
- `ACTIVE`: the recommended next area of implementation. Read before making changes in that area.
- `BACKLOG`: planned but not started. Skip unless the user explicitly asks for that feature area.
- `STABLE`: foundational direction or constraints that are not expected to change often. Read only when changing scope, non-goals, or package boundaries.
- `ROUTING`: index or sequencing material. Use it to decide which detailed file to open next.

## Current Slice

- Strengthen typed terminal output and CLI observability.
- Keep browser control based on raw Chrome DevTools Protocol.
- Preserve local-only defaults and avoid external telemetry.
