# Public API And Examples

Status: DONE. Public SDK examples are linked, typechecked, and cover the planned consumption paths.

## Goal

Keep the package easy to consume as a library.

## API Work

- Export stable contracts from `src/index.ts`.
- Keep implementation-only helpers unexported.
- Provide a small `BrowserSession` + `Agent` construction path.
- Provide action registry construction only after it exists.

## Examples

- [x] Basic navigation.
- [x] Agent task with local Chrome.
- [x] Agent task with remote CDP attach.
- [x] Structured extraction example.
- [x] Custom action example.

## Acceptance Criteria

- [x] Examples typecheck with the package.
- [x] README links to examples instead of duplicating all details.
