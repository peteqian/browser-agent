# browser-agent — MCP skill

How to drive `@peteqian/browser-agent`'s MCP server (`browser-agent-mcp`)
from a host agent.

## Tool families

Tools registered by `createServer()` (`packages/cli/src/mcp/server.ts`):

- **Session**: `launch_session`, `new_tab`, `list_tabs`, `switch_tab`,
  `close_tab`, `close_session`, `close_browser`, `list_artifacts`.
- **Navigation**: see `registerNavigationTools` — `navigate`, `go_back`,
  `go_forward`, `refresh`, `wait_for_text`.
- **Interaction**: `click`, `click_by`, `type`, `type_by`,
  `select_option`, `select_by`, `upload_file`, `send_keys`, `scroll`.
- **Extraction**: `get_snapshot`, `search_page`, `find_elements`,
  `find_text`, `get_dropdown_options`, `extract_content`, `screenshot`,
  `save_as_pdf`.
- **Agent**: `run_agent` — hand a whole task to the in-process loop.
- **Skills**: `list_skills`, `get_skill`.

Every non-session tool takes `sessionId` as the first argument.

## Lifecycle

1. `launch_session({ headless: true, startUrl })` → `{ sessionId }`.
2. Loop: observe → act → observe.
3. `close_session({ sessionId })` (or `close_browser`) at end of task.

Sessions auto-sweep when idle, but explicit close is cheaper and frees
the browser process immediately.

## `get_snapshot` vs `find_elements`

Two ways to learn about the page. They are complementary.

- **`get_snapshot`** — Returns the _full formatted observation_: URL,
  title, and the budgeted list of interactive elements with `[index]`
  refs. **Default starting point** for any new step. Use it whenever the
  page has changed (after navigate, click, scroll-load, etc.).

- **`find_elements`** — Returns a _narrow CSS-selector match_. Use when:
  - The snapshot is too large or noisy and you know a precise selector
    (e.g. `a.product-card`, `[data-testid="row"]`).
  - You need attributes the snapshot does not surface
    (`includeText: true`, custom `attributes` list).
  - You want a count of matches before deciding to act.

  `find_elements` does **not** replace a snapshot for actions — its
  results don't carry the same `[index]` numbering the indexed actions
  resolve against. After `find_elements`, take a `get_snapshot` (or use
  `click_by` with a locator) before clicking.

Other observation tools (use directly, no snapshot needed):

- `search_page` — text/regex search over rendered text with context.
- `find_text` — first occurrence of a literal string.
- `extract_content` — LLM-friendly content extraction with optional
  dedupe across pages.

## When to call `run_agent`

`run_agent` runs the SDK loop in-process — a full subtask end-to-end.
Use it when:

- The subtask is well-scoped ("find the cheapest flight LAX→SFO next
  Friday") and you want one tool call instead of dozens.
- You do not need to interleave host-agent reasoning with each step.

Otherwise prefer the step-by-step tools so the host stays in control.

## Profiling page latency

When the host suspects slow page loads or layout work is the bottleneck,
two MCP tools wrap CDP tracing:

- `profiler_start({ sessionId, categories? })` — begin a Chrome trace
  on the active session. Default categories cover devtools timeline,
  V8, Blink, and user_timing.
- `profiler_stop({ sessionId, fileName? })` — stop the trace and return
  Chrome Trace Event JSON. Pass `fileName` to write it under cwd
  (`.json` is appended if missing).

Pair these around the slow action — e.g. `profiler_start` → `navigate`
→ `profiler_stop`. The resulting JSON loads directly in
`chrome://tracing`.

## Skill discovery

- `list_skills()` → array of `{ name, summary }`.
- `get_skill({ name })` → combined markdown (`SKILL.md` + each reference
  joined with `# <filename>` headers). Load this at the start of a
  browser task to ground your tool use against the shipped binary
  version.

## References

For element-ref mechanics, the action vocabulary, and snapshot-first
workflow, call `get_skill({ name: "core" })`.
