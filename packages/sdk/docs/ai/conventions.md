# Conventions

## Editing rules

- Small, direct edits. Preserve the package boundary.
- Match existing code style. Don't refactor adjacent code that isn't broken.
- Don't add features, abstractions, or configurability beyond what the task requires.
- No comments explaining WHAT the code does. Only WHY when non-obvious.
- Don't reference current task / fix / callers in comments — that belongs in the PR description.

## Imports

- Public SDK consumers import from `@peteqian/browser-agent-sdk`.
- Internal-only SDK symbols import from `@peteqian/browser-agent-sdk/internal`.
- CLI/MCP consumers use the sibling runtime package `@peteqian/browser-agent`.
- Within the package, use relative paths.

## Tests

- Unit + integration tests use `bun test` (not Vitest, despite what the monorepo root says).
- Test files: `*.test.ts`. Excluded from build typecheck (covered by test run instead).
- Integration tests live in `src/__integration__/`. Helpers (`*.ts` without `.test.`) are typechecked.

## Refactoring

- Avoid backward-compat shims unless persisted data, shipped behavior, external consumers, or explicit requirements demand them.
- When moving code, preserve public types as part of the package API.
- If a type is internal to one implementation and not consumed across package boundaries, keep it local.

## Job-search legacy

`FoundJob`, `TrajectoryStep`, `Extractor`, `DistilledTrajectory` previously lived here and have been removed. Downstream packages that need them must define them locally — do not re-add them to the core package.
