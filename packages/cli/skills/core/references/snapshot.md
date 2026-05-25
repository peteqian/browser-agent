# Snapshot, indices, and stableId

How element references work in `browser-agent`.

## What a snapshot is

A `PageSnapshot` (`packages/sdk/src/dom/types.ts`) is captured fresh from
the page's accessibility tree + DOM via CDP. It contains:

```
{
  url, title,
  elements: ElementInfo[],
  stability: { readyState, pendingRequestCount },
}
```

Only _interactive_ and otherwise notable elements survive the budget
filter (`DEFAULT_DOM_BUDGETS` caps ~120 visible, ~1200 indexed). The
formatter renders each as one line tagged with its `[index]`.

## `ElementInfo` (per snapshot row)

```
{
  index,              // 0-based, valid ONLY for this snapshot
  tag, role, axRole,  // DOM tag + ARIA role + AX-tree-computed role
  text, name, ariaName, axName, ariaLabel, labelText,
  href, type, placeholder, value,
  testId,             // data-testid / data-test / data-cy / data-qa / data-action
  dataAttrs,          // other data-* attrs, keyed without `data-`
  bbox: { x, y, w, h },
  stableHandle,       // best human-readable id (kind + value)
  stableId,           // 8-hex-char cross-snapshot hash
  backendNodeId, framePath,
  selectorHint,
}
```

## `@eN` / `[index]` refs

- A compact element reference printed in the snapshot listing, e.g. `@e7`.
- The underlying numeric index is still `7`; MCP tools accept either
  `index: 7` or `ref: "@e7"` where supported.
- Resolved through `SelectorMap.byIndex` (`packages/sdk/src/dom/cdp-snapshot.ts`)
  to a `backendNodeId` + optional `frameId`. CDP `DOM.resolveNode` then
  produces an object id the action handler clicks/types.
- **Re-issued every snapshot.** Index 7 in snapshot A is almost never
  index 7 in snapshot B. If you act on a stale index, you will hit a
  different element or get a not-found error.

Rules:

- MCP action tools return a fresh observation and cache its selector map on
  the daemon session, so the next tool call can use the visible `@eN` refs.
- Re-snapshot after any out-of-band page change, or call `get_snapshot` when
  you need to refresh refs without acting.
- Within one snapshot, batch multiple non-mutating reads
  (`get_dropdown_options`, `find_text`) freely.

## `stableId`

- 8 hex chars, e.g. `"a1b2c3d4"`.
- Hash of: `framePath + tag + axRole + axName + testId +
bucketed-y-coordinate`. See `computeStableId` in
  `packages/sdk/src/dom/cdp-snapshot.ts`.
- Same conceptual element resolves to the same `stableId` across
  re-renders, page refreshes, and most layout shifts.
- Falls back to the volatile numeric index when no stable signal is
  computable — in that case it is no more durable than `[index]`.

Use via `click_by` / `type_by` / `select_by`:

```json
{ "name": "click_by", "params": { "locator": { "stableId": "a1b2c3d4" } } }
```

## Choosing a locator

When `[index]` is not safe (you navigated, refreshed, or held the ref
across snapshots), reach for `click_by` with one of:

- `role` + `name` — strongest semantic match (e.g. `role: "button", name: "Submit"`).
- `testid` — when the page authors maintain stable test ids.
- `label` / `placeholder` — for form fields.
- `text` — visible text content.
- `href` — for links.
- `dataAttr: { key, value }` — bespoke `data-*` hooks.
- `stableId` — when you captured one earlier and want to retry the same
  element after a re-render.

Add `nth` to disambiguate when multiple match.
