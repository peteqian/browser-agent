# browser-agent — core skill

Versioned guidance for host agents (Claude Code, Cursor, Codex) driving
`@peteqian/browser-agent`. Load this once per task to ground your tool use.

## What this controls

A long-lived Chromium session driven over CDP. A single `sessionId` holds the
browser, tabs, navigation history, and a per-step DOM snapshot. Every
interactive action is keyed against the most recent snapshot — stale indices
fail loudly.

## When to launch a session

Launch exactly one session per task. Reuse it across tabs.

1. `launch_session({ headless, startUrl? })` → returns `sessionId`.
2. Keep `sessionId` for the rest of the task.
3. `close_session({ sessionId })` (or `close_browser`) at the end, even on
   failure paths. The MCP server sweeps idle sessions but explicit close is
   cheaper.

## Snapshot-first workflow

Always observe before acting.

1. `get_snapshot({ sessionId })` → markdown listing of interactive elements,
   each tagged `[index]` with role, name/text, href, testid, etc.
2. Choose a target element from the listing. Read its `[index]` number.
3. Issue an action referring to that index — `click`, `type`,
   `select_option`, `upload_file`, `scroll`, `get_dropdown_options`.
4. After any navigation or DOM mutation, re-snapshot. Indices are
   re-numbered every snapshot. Do not reuse old indices.

If the snapshot is too noisy, narrow with `find_elements({ selector })` (CSS
selector) or `search_page({ pattern })` (text/regex) before snapshotting
again.

## `[index]` refs vs `stableId` vs `click_by`

Three ways to target an element. Prefer in this order:

1. **`[index]`** — cheapest, valid only against the latest snapshot. Use for
   simple click/type sequences immediately after a snapshot.
2. **`stableId`** — 8-hex-char hash from `ElementInfo.stableId`. Survives
   most re-renders. Pass via `click_by({ locator: { stableId } })` when you
   need to re-target the same conceptual element after a refresh.
3. **`click_by({ locator })`** with `role + name`, `text`, `testid`,
   `label`, `placeholder`, `href`, or `dataAttr`. Use when you have a
   semantic handle but no snapshot in hand (e.g. across navigations).

See `references/snapshot.md` for the full shape.

## Action vocabulary (summary)

Navigation: `navigate`, `go_back`, `go_forward`, `refresh`, `new_tab`,
`switch_tab`, `close_tab`, `close_browser`.

Interaction: `click`, `click_by`, `type`, `type_by`, `select_option`,
`select_by`, `upload_file`, `send_keys`, `scroll`.

Observation: `get_snapshot` (MCP) / serialized snapshot, `find_elements`,
`search_page`, `find_text`, `get_dropdown_options`, `extract_content`,
`screenshot`, `save_as_pdf`.

Control: `wait`, `wait_for_text`, `focus_area`, `done`.

Full list with shape: `references/actions.md`.

## Common pitfalls

- **Stale index.** Acting on an `[index]` from a snapshot taken before a
  click/navigation will resolve to a different element or fail. Re-snapshot
  after every state change.
- **Coordinate clicks.** `click` accepts `coordinateX`/`coordinateY` as a
  fallback. Reach for `index` first; coordinates break on layout shift.
- **`type` does not clear by default.** It clears before typing (`mode:
  "replace"`). Use `mode: "append"` when you want to extend existing text.
- **`submit: true`** on `type` presses Enter after typing — combines a type
  and a form submit into one step.
- **`find_elements` returns a CSS-selected list**, not interactive elements
  only. For role-based lookup, prefer `click_by`.
- **`extract_content` is for reading**, not scraping every page. It runs an
  LLM-friendly extractor on the current DOM; pass `alreadyCollected` to
  dedupe across paginated calls.
- **`wait_for_text`** is preferred over fixed-duration `wait` for
  determinism. Use `wait` only for animations or rate-limited UIs.
- **One `done` per task.** Emit `done({ success, summary, data? })` to end
  the loop. Without it the task runs to `maxSteps` and reports failure.

## Multi-step / persistent sessions

The MCP server keeps the browser alive across tool calls. Treat each
sequence of `get_snapshot` → action as one logical step. Do not relaunch
the browser between calls — `getSession(sessionId)` is the contract.

## References

- `references/actions.md` — every action, shape, and minimal example.
- `references/snapshot.md` — `[index]` ref + `stableId` mechanics.
