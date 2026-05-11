# Testing Strategy

Status: ACTIVE. Smoke verification exists; focused automated tests remain next quality work.

## Goal

Add confidence around contracts and local browser behavior without requiring hosted services.

## Tests

- Unit tests for action normalization and loop detection.
- Unit tests for DOM serialization budgets.
- Contract tests for public exported types where practical.
- Integration smoke tests for local Chrome launch and navigation.
- MCP startup smoke test.

## Watchdog Coverage

- Unit-test navigation health result shaping for success, timeout/error, and empty-page warnings.
- Unit-test that navigate action results include `data.navigation`.
- Unit-test that health-checked navigation emits `browser_event` named `navigation_watchdog`.
- Opt-in local browser integration tests cover navigation, downloads, and permission grants.

## Rules

- Tests must not depend on external hosted browser APIs.
- Network tests should be opt-in or use local fixtures when possible.
- Typecheck remains mandatory after meaningful TypeScript edits.

## Acceptance Criteria

- `bun run typecheck` passes.
- New feature layers include focused tests or documented manual verification.
