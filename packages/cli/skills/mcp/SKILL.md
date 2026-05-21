# browser-agent — MCP skill

How to drive `@peteqian/browser-agent`'s MCP server (`browser-agent-mcp`)
from a host agent.

## Tool families

Tools registered by `createServer()` (`packages/cli/src/mcp/server.ts`):

- **Session**: `launch_session`, `list_sessions`, `attach_session`,
  `new_tab`, `list_tabs`, `switch_tab`, `close_tab`, `close_session`,
  `close_browser`, `list_artifacts`, `list_session_events`.
- **Navigation**: see `registerNavigationTools` — `navigate`, `go_back`,
  `go_forward`, `refresh`, `wait_for_text`.
- **Interaction**: `run_actions`, `click`, `click_by`, `focus`, `fill`,
  `type`, `type_by`, `select_option`, `select_by`, `upload_file`,
  `send_keys`, `press`, `keyboard_type`, `scroll`.
- **Extraction**: `get_snapshot`, `search_page`, `find_elements`,
  `find_text`, `get_dropdown_options`, `extract_content`, `screenshot`,
  `save_as_pdf`.
- **Agent**: `run_agent` — hand a whole task to the in-process loop.
- **Skills**: `list_skills`, `get_skill`.
- **Daemon bridge**: `daemon_status`, `daemon_launch_session`,
  `daemon_list_sessions`, `daemon_attach_session`, `daemon_get_snapshot`,
  `daemon_action`, `daemon_actions`, `daemon_session_events`,
  `daemon_close_session`.

Every non-session tool takes `sessionId` as the first argument.

## Browser runtime

Before a host wires MCP for the first time, `browser-agent browser status`
checks whether Chromium/Chrome is discoverable and
`browser-agent browser install` installs Playwright-managed Chromium when
needed. This is an installability preflight only. Cookie banners and login
state are handled with `autoConsent`, named profiles, and storage state.

## Lifecycle

1. `launch_session({ headless: true, startUrl })` → `{ sessionId }`.
2. Loop: use the returned observation → act with `ref: "@eN"` → use the next
   returned observation.
3. `close_session({ sessionId })` (or `close_browser`) at end of task.

Sessions auto-sweep when idle, but explicit close is cheaper and frees
the browser process immediately.

For auth or sites that remember preferences, pass
`profile: "site-name"` to `launch_session` or `run_agent`. Named profiles
store Chrome user data plus storage state under
`~/.browser-agent/profiles/<name>/`. Use explicit `userDataDir` or
`storageStatePath` only when the host needs a custom location.

If you lose the active `sessionId` but the MCP daemon is still running, call
`list_sessions` or `attach_session({ profile: "site-name" })`. `attach_session`
returns the current observation, so continue with the latest returned `@eN`
refs.

For debugging or dashboard views, call `list_session_events({ sessionId })`.
It returns recent lifecycle/action events with action name, ok/fail status,
message, duration, and URL when available.
Outside MCP, `browser-agent dashboard` starts a local HTTP dashboard with the
same session registry, JSON APIs, and SSE event stream for sessions launched
from that dashboard process.
`browser-agent dashboard status` reads `~/.browser-agent/daemon.json` and
calls `/api/health` so a fresh process can find the running dashboard daemon.
If that health check fails, `dashboard status` and `daemon_status` clear the
stale manifest before reporting `running: false`.
From a fresh MCP process, use `daemon_status` → `daemon_launch_session` or
`daemon_list_sessions` → `daemon_attach_session` → `daemon_action` /
`daemon_get_snapshot` to drive sessions owned by that dashboard daemon.
`daemon_launch_session` accepts the same profile, persistence, browser channel,
locale, and timezone inputs as `launch_session` and returns the first
observation. Close dashboard-owned sessions with `daemon_close_session`. Keep
normal tools for sessions launched inside the current MCP process.

Use `run_actions` only for short bursts where no intermediate page read is
needed, such as `focus` → `keyboard_type` → `press`. It runs up to 10 simple
actions in order and returns one final observation. If a click opens a menu,
calendar, modal, or navigates, prefer a normal single action so the next
decision sees the updated `@eN` refs.

## `get_snapshot` vs `find_elements`

Two ways to learn about the page. They are complementary.

- **`get_snapshot`** — Returns the _full formatted observation_: URL,
  title, and the budgeted list of interactive elements with `@eN`
  refs. **Default starting point** for any new step. Use it whenever the
  page has changed outside the MCP action flow. Action tools already return
  and cache a fresh observation.

- **`find_elements`** — Returns a _narrow CSS-selector match_. Use when:
  - The snapshot is too large or noisy and you know a precise selector
    (e.g. `a.product-card`, `[data-testid="row"]`).
  - You need attributes the snapshot does not surface
    (`includeText: true`, custom `attributes` list).
  - You want a count of matches before deciding to act.

  `find_elements` does **not** replace a snapshot for actions — its results
  don't carry the same `@eN` numbering the indexed actions resolve against.
  After `find_elements`, use the latest returned observation, take a
  `get_snapshot`, or use `click_by` with a locator before clicking.

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
