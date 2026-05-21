# Public API And Examples

Status: PARTIAL. Typed output and custom-action examples are done; load this file when changing exports or examples.

## Goal

Keep the package easy to consume as a library.

## API Work

- Export stable contracts from `src/index.ts`.
- Keep implementation-only helpers unexported.
- Provide a small `BrowserSession` + `Agent` construction path.
- Provide action registry construction only after it exists.

## Examples

- Basic navigation.
- Agent task with local Chrome.
- Agent task with remote CDP attach.
- Structured extraction example.
- [x] Custom action example.

## Acceptance Criteria

- [x] Examples typecheck with the package.
- README links to examples instead of duplicating all details.
