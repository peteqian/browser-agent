# MCP

Status: DONE. Core session tools, direct browser tools, cleanup, artifact listing, and dashboard-daemon bridge tools are implemented and verified.

## Goal

Expose browser-agent capabilities to MCP clients without stdout/logging interference.

## Features

- Tool to run an autonomous browser task.
- Direct browser tools for navigate, click, type, screenshot, and extract.
- Session-scoped state for follow-up operations.
- Explicit artifact paths in results.

## Completed

- MCP server exposes session launch/close, tab management, direct browser actions, extraction, screenshots, PDFs, and autonomous `run_agent`.
- MCP direct tools share the same action/browser runtime as the agent loop.
- MCP sessions are swept after idle timeouts and can be shut down cleanly in tests.
- Screenshot/PDF tools record filesystem artifact paths, and `list_artifacts` returns them in creation order.
- Dashboard-owned sessions are reachable from fresh MCP processes through `daemon_*` tools, including session launch/attach/list, snapshot, extraction, screenshot/PDF, artifact listing, action execution, events, and close.
- The HTTP dashboard exposes session events, snapshots, artifacts, and action execution without stdout interference.

## Rules

- Logs go to stderr.
- MCP responses are typed and deterministic.
- No cloud-hosted browser assumptions.

## Acceptance Criteria

- [x] `bun run mcp` starts cleanly.
- [x] MCP direct tools and agent tools share the same action/browser runtime.
- [x] Sessions have cleanup/timeouts that prevent stale browser processes.
- [x] Artifact-producing tools return explicit local paths.
