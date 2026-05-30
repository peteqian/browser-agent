# Agentic Browsing Architecture Notes

## Vercel browser-agent Comparison

We exercised Vercel's `browser-agent` CLI against the SEEK apply task:

1. `browser-agent chat "..."` is the closest one-shot equivalent, but it is gated on `AI_GATEWAY_API_KEY`.
2. Its primitive layer worked immediately in a headed session:
   - opened the SEEK search URL,
   - returned a compact interactive accessibility snapshot with stable `@e...` refs,
   - clicked the first result by ref,
   - clicked the page's Apply link by ref.
3. It launched Chrome for Testing from `~/.browser-agent/browsers/...`, keeping automation separate from the user's normal Chrome profile.

The useful architectural lesson is not the exact CLI shape. It is that the AI should operate at the task level while the browser layer exposes fast, deterministic primitives against a persistent session.

## Current Gaps

- The library still spends too many observe/decide/act cycles on atomic browser work.
- Snapshot capture, decision prompting, action execution, and loop recovery all live in the same runtime loop, which makes it harder to optimize each independently.
- The public SDK now exposes `runTask(...)` as the first-class one-task wrapper, but primitive session controls are not yet a stable public SDK surface.
- Auth/profile reuse is now supported, but session/process ownership is still less explicit than Vercel's `--session`, `--session-name`, and `--profile` split.

## First Change: Bounded Same-Observation Batches

The decision contract now allows up to 4 actions per model decision. The runner executes safe same-observation batches, then stops the batch when an action can invalidate the DOM:

- safe to batch: `focus`, `hover`, `type`, `fill`, `type_by`, non-mutating reads, and `done`;
- re-observe after: navigation, tab actions, click/dblclick, scroll, submit, upload, waits-for-page-change, extraction, and selects;
- failed actions do not force a re-observe because the page usually did not change;
- `done` may follow a final click/navigation-like action when the task explicitly ends at that click.

This keeps the one-shot public API while reducing LLM turns for workflows such as filling search forms.

## Second Change: Shared Runtime Primitives

Observation and action execution now have SDK runtime modules:

- `runtime/observer` exposes `observePage` and `refreshPageState`.
- `runtime/executor` exposes `executeRuntimeAction`, `runRuntimeActions`, and `shouldReobserve`.

The Agent loop uses these modules for step observation and action execution. The MCP session helpers also use them for primitive tool calls. This removes the split where MCP had its own post-action observation retry logic and direct `executeAction` path while the Agent loop used a separate timeout wrapper.

This is the beginning of the Vercel-like shape: browser primitives are shared and deterministic, while the natural-language Agent is a layer over those primitives.

## Third Change: SessionRunner

`runtime/SessionRunner` now owns the persistent browser session, active page, latest observation, action registry, allowed domains, and DOM budgets. It composes the shared observer/executor modules and gives callers a smaller runtime surface:

- `observe` and `refresh` keep the latest browser state in one place;
- `runAction` executes one primitive against the cached selector map, then clears stale state when the action can change the page;
- `runActions` executes a bounded primitive batch and can stop on failure for MCP-style deterministic command lists.

MCP sessions now keep a `SessionRunner` on each `SessionRecord`, and the Agent loop creates one runner per task. That means the natural-language one-shot path and primitive MCP path now share the same page/current-state ownership instead of each maintaining separate action and observation plumbing.

The SDK also exposes `runTask(...)` as the first-class one-shot wrapper:

```ts
await runTask({ task, profile: "seek", headless: false });
```

## Next Major Changes

1. Make observations incremental by default.
   Keep a cached full snapshot, send compact diffs to the model, and let primitives operate from the cached selector map until an invalidating action forces refresh.

2. Promote browser primitives as a stable SDK surface.
   Natural-language agents should be a layer over primitives, not the only way to drive the browser.

3. Separate task completion from page observation.
   Some tasks end at an action boundary, like "click Apply"; they should be allowed to terminate without spending another observation/decision turn.
