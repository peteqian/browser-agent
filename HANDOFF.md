# Handoff: browser-agent refinement

## Current State

- Repository: `/Users/applecakes/projects/practice/browser-agent`
- Branch: `feat/feature-improvements`
- Remote tracking: `origin/feat/feature-improvements`
- Status when written: clean worktree, branch is `ahead 13`
- Latest local commit: `059fdaa Honor diff display budgets`
- Remote currently points at: `fc5d666 Add daemon extraction tools`
- Push status: the 13 local commits after `fc5d666` have not been pushed.
- Commit identity used for recent commits: `Peter Qian <peter.qian.dev@gmail.com>`

The active thread goal is still broad: keep refining the repo toward better browser-agent ergonomics and capability. Earlier clarification: this means getting closer to Vercel-style browser-agent usefulness, but not cloning Vercel's library. The working direction is local-first TypeScript SDK + CLI/MCP + daemon/dashboard workflows.

## Start Here

Read these first:

- [`.plans/STATUS.md`](./.plans/STATUS.md): compact routing table and completed feature inventory.
- [`.plans/HIGH-VALUE-FEATURES.md`](./.plans/HIGH-VALUE-FEATURES.md): dependency-ordered roadmap.
- [`.plans/05-quality/01-testing-strategy.md`](./.plans/05-quality/01-testing-strategy.md): current active quality plan.
- [`.plans/04-interfaces/03-public-api-and-examples.md`](./.plans/04-interfaces/03-public-api-and-examples.md): now marked done for SDK examples/public API consumption paths.

## What Was Just Done

Local commits not on remote:

1. `237c3c4 Show artifacts in dashboard`
   - Dashboard session summary includes artifact count and UI artifact listing.
   - Files: [`packages/cli/src/dashboard/server.ts`](./packages/cli/src/dashboard/server.ts), [`packages/cli/src/dashboard/server.test.ts`](./packages/cli/src/dashboard/server.test.ts)

2. `8b866db Update MCP roadmap status`
   - Marked MCP daemon/session work as done in plans.
   - Files: [`.plans/04-interfaces/02-mcp.md`](./.plans/04-interfaces/02-mcp.md), [`.plans/STATUS.md`](./.plans/STATUS.md)

3. `b5a3872 Document dashboard daemon commands`
   - Documented dashboard daemon and MCP/profile workflows.
   - Files: [`packages/cli/README.md`](./packages/cli/README.md), [`packages/cli/CHANGELOG.md`](./packages/cli/CHANGELOG.md)

4. `34e4c58 Tighten dashboard route methods`
   - Dashboard `/events`, `/snapshot`, and `/artifacts` require `GET`.
   - File: [`packages/cli/src/dashboard/server.ts`](./packages/cli/src/dashboard/server.ts)

5. `6e586b5 Expose extraction schema options in MCP`
   - Direct MCP and daemon extraction tools expose and forward `alreadyCollected` and `schemaJson`.
   - Files:
     - [`packages/cli/src/mcp/tools/extraction.ts`](./packages/cli/src/mcp/tools/extraction.ts)
     - [`packages/cli/src/mcp/tools/daemon.ts`](./packages/cli/src/mcp/tools/daemon.ts)
     - [`packages/cli/src/mcp/tools/daemon.test.ts`](./packages/cli/src/mcp/tools/daemon.test.ts)
     - [`packages/cli/skills/core/SKILL.md`](./packages/cli/skills/core/SKILL.md)
     - [`packages/cli/skills/core/references/actions.md`](./packages/cli/skills/core/references/actions.md)
     - [`packages/cli/skills/mcp/SKILL.md`](./packages/cli/skills/mcp/SKILL.md)

6. `f432657 Refresh SDK action docs`
   - SDK README/action guide list the current 43-action surface.
   - Files: [`packages/sdk/README.md`](./packages/sdk/README.md), [`packages/sdk/docs/guides/actions.md`](./packages/sdk/docs/guides/actions.md)

7. `b5741ab Fix SDK contract docs package names`
   - Corrected contract docs after SDK/runtime split.
   - File: [`packages/sdk/docs/ai/contracts.md`](./packages/sdk/docs/ai/contracts.md)

8. `01a4580 Fix SDK docs package references`
   - SDK docs now point SDK imports to `@peteqian/browser-agent-sdk`; CLI/MCP runtime references remain `@peteqian/browser-agent`.
   - Files:
     - [`packages/sdk/docs/index.md`](./packages/sdk/docs/index.md)
     - [`packages/sdk/docs/getting-started.md`](./packages/sdk/docs/getting-started.md)
     - [`packages/sdk/docs/guides/sdk.md`](./packages/sdk/docs/guides/sdk.md)
     - [`packages/sdk/docs/ai/README.md`](./packages/sdk/docs/ai/README.md)
     - [`packages/sdk/docs/ai/architecture.md`](./packages/sdk/docs/ai/architecture.md)
     - [`packages/sdk/docs/ai/conventions.md`](./packages/sdk/docs/ai/conventions.md)
     - [`packages/sdk/docs/ai/troubleshooting.md`](./packages/sdk/docs/ai/troubleshooting.md)

9. `afb2506 Add SDK custom action example`
   - Added public `ActionResult` export.
   - Tightened `ActionRegistry.register()` typing for strongly typed custom actions.
   - Added `examples/custom-action.ts`.
   - Added `typecheck:examples`.
   - Files:
     - [`packages/sdk/src/actions/registry.ts`](./packages/sdk/src/actions/registry.ts)
     - [`packages/sdk/src/index.ts`](./packages/sdk/src/index.ts)
     - [`packages/sdk/examples/custom-action.ts`](./packages/sdk/examples/custom-action.ts)
     - [`packages/sdk/tsconfig.examples.json`](./packages/sdk/tsconfig.examples.json)
     - [`packages/sdk/package.json`](./packages/sdk/package.json)

10. `626fdf3 Add remote CDP SDK example`
    - Added `BrowserSession.connect(cdpUrl, options)`.
    - Exported `BrowserSessionConnectOptions`.
    - Added `examples/remote-cdp.ts` and `example:remote-cdp`.
    - Added focused remote CDP profile behavior test.
    - Files:
      - [`packages/sdk/src/browser/session.ts`](./packages/sdk/src/browser/session.ts)
      - [`packages/sdk/src/browser/session-types.ts`](./packages/sdk/src/browser/session-types.ts)
      - [`packages/sdk/src/browser/session.test.ts`](./packages/sdk/src/browser/session.test.ts)
      - [`packages/sdk/examples/remote-cdp.ts`](./packages/sdk/examples/remote-cdp.ts)
      - [`packages/sdk/src/index.ts`](./packages/sdk/src/index.ts)

11. `e7d6d13 Link SDK examples from README`
    - README now links directly to core examples instead of saying "etc."
    - Public API/examples plan marked `DONE`.
    - Files: [`packages/sdk/README.md`](./packages/sdk/README.md), [`.plans/04-interfaces/03-public-api-and-examples.md`](./.plans/04-interfaces/03-public-api-and-examples.md)

12. `c1d7285 Add MCP startup smoke test`
    - Added in-memory MCP client/server startup smoke.
    - Verifies core tools: `launch_session`, `run_agent`, `daemon_status`, `extract_content`, `list_artifacts`.
    - Files: [`packages/cli/src/mcp/server.test.ts`](./packages/cli/src/mcp/server.test.ts), [`.plans/05-quality/01-testing-strategy.md`](./.plans/05-quality/01-testing-strategy.md)

13. `059fdaa Honor diff display budgets`
    - `formatSnapshotDiff` now respects `maxDisplayElements`.
    - Adds `... N diff entries truncated` when diff entries are omitted.
    - Adds tests for diff display budget and max-total fallback.
    - Files:
      - [`packages/sdk/src/dom/serialize.ts`](./packages/sdk/src/dom/serialize.ts)
      - [`packages/sdk/src/dom/serialize.test.ts`](./packages/sdk/src/dom/serialize.test.ts)
      - [`.plans/05-quality/01-testing-strategy.md`](./.plans/05-quality/01-testing-strategy.md)

## Important Feature Areas And References

### SDK Public Surface

- Public SDK exports: [`packages/sdk/src/index.ts`](./packages/sdk/src/index.ts)
- Internal exports: [`packages/sdk/src/internal.ts`](./packages/sdk/src/internal.ts)
- Public examples:
  - [`packages/sdk/examples/goto.ts`](./packages/sdk/examples/goto.ts)
  - [`packages/sdk/examples/simple-agent.ts`](./packages/sdk/examples/simple-agent.ts)
  - [`packages/sdk/examples/agent.ts`](./packages/sdk/examples/agent.ts)
  - [`packages/sdk/examples/typed-output.ts`](./packages/sdk/examples/typed-output.ts)
  - [`packages/sdk/examples/custom-action.ts`](./packages/sdk/examples/custom-action.ts)
  - [`packages/sdk/examples/remote-cdp.ts`](./packages/sdk/examples/remote-cdp.ts)
  - [`packages/sdk/examples/extraction.ts`](./packages/sdk/examples/extraction.ts)
  - [`packages/sdk/examples/downloads.ts`](./packages/sdk/examples/downloads.ts)
  - [`packages/sdk/examples/upload.ts`](./packages/sdk/examples/upload.ts)
  - [`packages/sdk/examples/storage-state.ts`](./packages/sdk/examples/storage-state.ts)
- Examples typecheck config: [`packages/sdk/tsconfig.examples.json`](./packages/sdk/tsconfig.examples.json)

### Browser Runtime And Watchdogs

- Session lifecycle: [`packages/sdk/src/browser/session.ts`](./packages/sdk/src/browser/session.ts)
- Session types: [`packages/sdk/src/browser/session-types.ts`](./packages/sdk/src/browser/session-types.ts)
- Browser facade: [`packages/sdk/src/browser/browser.ts`](./packages/sdk/src/browser/browser.ts)
- Navigation health: [`packages/sdk/src/browser/page-navigation.ts`](./packages/sdk/src/browser/page-navigation.ts)
- Watchdog plan: [`.plans/02-browser-runtime/02-watchdogs.md`](./.plans/02-browser-runtime/02-watchdogs.md)

### DOM, Snapshots, And Action Targeting

- CDP snapshot capture and budgets: [`packages/sdk/src/dom/cdp-snapshot.ts`](./packages/sdk/src/dom/cdp-snapshot.ts)
- LLM snapshot formatting and diffing: [`packages/sdk/src/dom/serialize.ts`](./packages/sdk/src/dom/serialize.ts)
- DOM budget tests: [`packages/sdk/src/dom/serialize.test.ts`](./packages/sdk/src/dom/serialize.test.ts)
- DOM enrichment plan: [`.plans/03-dom-and-actions/01-dom-snapshot-enrichment.md`](./.plans/03-dom-and-actions/01-dom-snapshot-enrichment.md)

### Actions And Extraction

- Action schema catalog: [`packages/sdk/src/actions/types.ts`](./packages/sdk/src/actions/types.ts)
- Action registry: [`packages/sdk/src/actions/registry.ts`](./packages/sdk/src/actions/registry.ts)
- Action executor: [`packages/sdk/src/actions/execute.ts`](./packages/sdk/src/actions/execute.ts)
- Navigation handlers: [`packages/sdk/src/actions/handlers/navigation.ts`](./packages/sdk/src/actions/handlers/navigation.ts)
- Interaction handlers: [`packages/sdk/src/actions/handlers/interaction.ts`](./packages/sdk/src/actions/handlers/interaction.ts)
- Extraction handlers: [`packages/sdk/src/actions/handlers/extraction.ts`](./packages/sdk/src/actions/handlers/extraction.ts)
- Action registry plan: [`.plans/03-dom-and-actions/02-action-registry.md`](./.plans/03-dom-and-actions/02-action-registry.md)
- Extraction plan: [`.plans/03-dom-and-actions/03-extraction-and-structured-output.md`](./.plans/03-dom-and-actions/03-extraction-and-structured-output.md)

### CLI, MCP, Dashboard, And Daemon

- CLI entrypoint: [`packages/cli/bin/cli.ts`](./packages/cli/bin/cli.ts)
- MCP entrypoint: [`packages/cli/bin/mcp.ts`](./packages/cli/bin/mcp.ts)
- MCP server construction: [`packages/cli/src/mcp/server.ts`](./packages/cli/src/mcp/server.ts)
- MCP startup/session tests: [`packages/cli/src/mcp/server.test.ts`](./packages/cli/src/mcp/server.test.ts)
- MCP daemon tools: [`packages/cli/src/mcp/tools/daemon.ts`](./packages/cli/src/mcp/tools/daemon.ts)
- MCP extraction tools: [`packages/cli/src/mcp/tools/extraction.ts`](./packages/cli/src/mcp/tools/extraction.ts)
- Dashboard server: [`packages/cli/src/dashboard/server.ts`](./packages/cli/src/dashboard/server.ts)
- CLI README: [`packages/cli/README.md`](./packages/cli/README.md)
- MCP plan: [`.plans/04-interfaces/02-mcp.md`](./.plans/04-interfaces/02-mcp.md)

## Verification Already Run

Representative commands run successfully across the recent slices:

```sh
bun test packages/sdk/src/dom/serialize.test.ts
bun test packages/cli/src/mcp/server.test.ts
bun test packages/sdk/src/browser/session.test.ts packages/sdk/src/sdk-consumer.test.ts
bun test packages/sdk/src/actions/registry.test.ts packages/sdk/src/sdk-consumer.test.ts
bun test packages/cli/src/dashboard/server.test.ts
bun test packages/cli/src/mcp/tools/daemon.test.ts packages/cli/src/mcp/server.test.ts

bun run typecheck
bun run typecheck:examples
bun lint
bun fmt
bun run build
git diff --check
```

Notes:

- `bun run typecheck` was run from package directories for package-specific checks, for example `packages/sdk` and `packages/cli`.
- Full `bun test` passed earlier after `fc5d666`; later slices used focused tests plus typecheck/lint/build where relevant.
- No push was performed after the 13 local commits listed above.

## Known Cautions

- Do not revert unrelated local changes if any appear later. The branch is clean at this handoff.
- The user previously requested all commit author/committer identities be `Peter Qian <peter.qian.dev@gmail.com>`. Verify before any future commit with:

```sh
git show -s --format='%h %an <%ae> | %cn <%ce> | %s' HEAD
```

- Browser integration tests are gated behind environment flags such as `BAGENT_INT=1`; do not assume local Chrome integration is always available in sandboxed runs.
- Bun command syntax matters. To run a package script, prefer setting `workdir` to the package directory, for example:

```sh
cd packages/sdk && bun run typecheck:examples
```

- The broad refinement goal should not be marked complete merely because a slice is committed. Continue making small verified improvements until the user says to stop, push, or change direction.

## Suggested Next Work

Choose one small slice, inspect first, then implement and verify:

1. Quality plan: contract tests for public exported types.
   - Plan: [`.plans/05-quality/01-testing-strategy.md`](./.plans/05-quality/01-testing-strategy.md)
   - Likely files: [`packages/sdk/src/sdk-consumer.test.ts`](./packages/sdk/src/sdk-consumer.test.ts), [`packages/sdk/src/index.ts`](./packages/sdk/src/index.ts)
   - Goal: prove common consumer imports keep working from the public entrypoint.

2. Quality plan: action normalization tests.
   - Plan: [`.plans/05-quality/01-testing-strategy.md`](./.plans/05-quality/01-testing-strategy.md)
   - Likely files: [`packages/sdk/src/actions/registry.test.ts`](./packages/sdk/src/actions/registry.test.ts), [`packages/sdk/src/actions/types.ts`](./packages/sdk/src/actions/types.ts)
   - Goal: cover defaulted params and schema parse behavior for important action inputs.

3. Observability/privacy follow-up.
   - Plan: [`.plans/05-quality/02-observability-and-privacy.md`](./.plans/05-quality/02-observability-and-privacy.md)
   - Likely files: [`packages/sdk/src/agent/redaction.property.test.ts`](./packages/sdk/src/agent/redaction.property.test.ts), [`packages/cli/bin/cli.ts`](./packages/cli/bin/cli.ts)
   - Goal: keep local diagnostics useful without leaking secrets or adding external telemetry.

4. Extraction quality.
   - Plan: [`.plans/03-dom-and-actions/03-extraction-and-structured-output.md`](./.plans/03-dom-and-actions/03-extraction-and-structured-output.md)
   - Likely files: [`packages/sdk/src/actions/handlers/extraction.ts`](./packages/sdk/src/actions/handlers/extraction.ts), [`packages/sdk/examples/extraction.ts`](./packages/sdk/examples/extraction.ts)
   - Goal: improve long/noisy page extraction and structured extraction behavior.

## Push Or PR Notes

If the user asks to push, current branch should be a normal fast-forward push from local to remote because it is ahead of `origin/feat/feature-improvements` by 13 and not behind at handoff time:

```sh
git push
```

If remote changes appear before pushing, inspect first:

```sh
git fetch
git status --short --branch
git log --oneline --left-right --cherry-pick origin/feat/feature-improvements...HEAD
```
