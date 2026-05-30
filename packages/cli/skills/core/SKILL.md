# browser-agent — core skill

Versioned guidance for host agents (Claude Code, Cursor, Codex) driving
`@peteqian/browser-agent`. Load this once per task to ground your tool use.

## What this controls

A long-lived Chromium session driven over CDP. A single `sessionId` holds the
browser, tabs, navigation history, storage/profile state, and the latest DOM
snapshot. Every interactive action is keyed against the most recent observation
— stale refs fail loudly.

## When to launch a session

Launch exactly one session per task. Reuse it across tabs.

1. `launch_session({ headless, startUrl? })` → returns `sessionId`.
2. Keep `sessionId` for the rest of the task.
3. `close_session({ sessionId })` (or `close_browser`) at the end, even on
   failure paths. The MCP server sweeps idle sessions but explicit close is
   cheaper.

If the browser runtime itself is missing, run
`browser-agent browser status` or `browser-agent browser install` before
starting the MCP workflow. That installs a managed Chromium build; it does not
replace profile persistence or cookie handling.

## Snapshot-first workflow

Always observe before acting.

1. `launch_session({ headless, startUrl? })` or `get_snapshot({ sessionId })`
   returns an observation listing interactive elements as `@eN`.
2. Choose a target element from that observation.
3. Issue an action with `ref: "@eN"` or `index: N` — `click`, `focus`, `fill`,
   `type`, `select_option`, `upload_file`, `scroll`, `get_dropdown_options`.
4. Most action tools return the next observation and cache its selector map on
   the daemon session. Use the newest returned `@eN` refs for the next action.

For repeatable auth/session persistence, launch with
`profile: "site-name"`. The CLI/MCP layer maps that name to
`~/.browser-agent/profiles/<name>/user-data` and
`~/.browser-agent/profiles/<name>/storage-state.json`.
If the host loses the active `sessionId`, call `list_sessions` or
`attach_session({ profile: "site-name" })` while the daemon is still alive.
For dashboard/debugging, `list_session_events({ sessionId })` returns the
recent lifecycle/action log.

If the snapshot is too noisy, narrow with `find_elements({ selector })` (CSS
selector) or `search_page({ pattern })` (text/regex) before snapshotting
again.

## `@eN` refs vs `stableId` vs `click_by`

Three ways to target an element. Prefer in this order:

1. **`@eN` / `index`** — cheapest, valid only against the latest observation.
   Use for simple click/type sequences immediately after an observation.
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

Interaction: `click`, `click_by`, `focus`, `fill`, `type`, `type_by`,
`select_option`, `select_by`, `upload_file`, `send_keys`, `press`,
`keyboard_type`, `scroll`.

Observation: `get_snapshot` (MCP) / serialized snapshot, `find_elements`,
`search_page`, `find_text`, `get_dropdown_options`, `extract_content`,
`screenshot`, `save_as_pdf`.

Control: `wait`, `wait_for_text`, `focus_area`, `done`.

Full list with shape: `references/actions.md`.

## Common pitfalls

- **Stale ref.** Acting on an `@eN` from an observation taken before a
  click/navigation will resolve to a different element or fail. Re-snapshot
  or use the observation returned by the previous action after every state
  change.
- **Coordinate clicks.** `click` accepts `coordinateX`/`coordinateY` as a
  fallback. Reach for `index` first; coordinates break on layout shift.
- **`type` does not clear by default.** It clears before typing (`mode:
"replace"`). Use `mode: "append"` when you want to extend existing text.
- **`submit: true`** on `type` presses Enter after typing — combines a type
  and a form submit into one step.
- **Autocomplete fields.** Prefer `fill` or `focus` + `keyboard_type` +
  `press` so the page receives browser keyboard events.
- **`find_elements` returns a CSS-selected list**, not interactive elements
  only. For role-based lookup, prefer `click_by`.
- **`extract_content` is the right tool for reading page text/values.** It
  runs an LLM-friendly extractor on the current DOM; pass a tight `query`
  (e.g. "top hotel name and price") to scope the output. Pass
  `alreadyCollected` to dedupe across paginated calls. If the host
  configured an extraction LLM hook, pass `schemaJson` for structured
  output.
- **Do NOT use `eval` to scrape page text or prices via CSS selectors.**
  Site class names change constantly and the approach loops forever. `eval`
  is only for values the DOM can't tell you (window globals, framework
  state, page-side math). Reach for `extract_content`, the observation
  itself, or `screenshot --annotate` instead.
- **`wait_for_text`** is preferred over fixed-duration `wait` for
  determinism. Use `wait` only for animations or rate-limited UIs.
- **One `done` per task.** Emit `done({ success, summary, data? })` to end
  the loop. Without it the agent continues until cancellation, loop detection,
  or the consecutive-failure guard stops it.

## Multi-step / persistent sessions

The MCP server keeps the browser alive across tool calls. Treat each
returned observation → action as one logical step. Do not relaunch the browser
between calls — `getSession(sessionId)` is the contract.

## Diagnosing slow runs

Agent steps usually break into three layers — LLM decision, DOM
snapshot, and the action itself. To see which layer dominates:

- Run the CLI with `--summary`. After the loop terminates, a per-step
  table prints to stdout with columns `decision / snapshot / action /
total / status`, plus aggregate percentages.
- For deeper page-side latency (paint, scripting, network), pair
  `profiler_start` / `profiler_stop` around the slow segment. They wrap
  CDP `Tracing.start` / `Tracing.end` and emit Chrome Trace Event JSON
  you can drop into `chrome://tracing` or `chrome://performance`. Pass
  `fileName` to `profiler_stop` to write the trace under cwd.
- The same per-layer signal is emitted as structured events
  (`decision_started/_completed`, `snapshot_started/_captured`,
  `action_started/_completed`), so `--json` consumers can aggregate
  identically without re-parsing the table.

## References

- `references/actions.md` — every action, shape, and minimal example.
- `references/snapshot.md` — `[index]` ref + `stableId` mechanics.
