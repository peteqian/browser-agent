# Actions

Every action accepted by `executeAction` (`packages/sdk/src/actions/types.ts`).
Each entry: one-line description + minimal JSON params.

## Navigation

- **`navigate`** — Go to a URL. Optionally open in a new tab.
  `{ "url": "https://example.com" }`
- **`go_back`** — History back. `{}`
- **`go_forward`** — History forward. `{}`
- **`refresh`** — Reload current tab. `{}`
- **`new_tab`** — Open a new tab and make it active. `{ "url": "https://example.com" }`
- **`switch_tab`** — Switch active tab by `targetId` or numeric `pageId`.
  `{ "pageId": 1 }`
- **`close_tab`** — Close tab by `targetId`, `pageId`, or active tab if
  both omitted. `{ "pageId": 1 }`
- **`close_browser`** — Close the whole browser session. `{}`

## Interaction (index-based)

- **`run_actions`** — MCP-only helper that runs 1-10 simple actions in
  order and returns one final observation. Use only when no intermediate
  `@eN` refresh is needed. Example:
  `{ "actions": [{ "name": "focus", "ref": "@e4" }, { "name": "keyboard_type", "text": "Sydney" }, { "name": "press", "key": "Enter" }] }`
- **`click`** — Click element `[index]` from the latest snapshot, or by
  pixel coords. MCP tools also accept `ref: "@e7"`. `{ "index": 7 }`
- **`focus`** — Focus an element so later keyboard calls target it.
  `{ "index": 4 }`
- **`type`** — Type text into element `[index]` using browser input. Default `mode` is
  `"replace"`; set `submit: true` to press Enter after.
  `{ "index": 4, "text": "hello", "submit": true }`
- **`fill`** — Focus and replace text in element `[index]`.
  `{ "index": 4, "text": "Sydney" }`
- **`select_option`** — Choose a `<select>` option by visible label or
  value. `{ "index": 9, "value": "AU" }`
- **`upload_file`** — Set files on a file input.
  `{ "index": 2, "paths": ["/tmp/a.pdf"] }`
- **`send_keys`** — Send raw key string to the focused element.
  `{ "keys": "Control+A" }`
- **`press`** — Press a key or chord on the focused element.
  `{ "key": "Enter" }`
- **`keyboard_type`** — Type text into the focused element.
  `{ "text": "Sydney" }`
- **`scroll`** — Scroll page or container at `[index]`.
  `{ "direction": "down", "pages": 1 }`

## Interaction (locator-based)

Use when no fresh snapshot exists or to target across re-renders.

- **`click_by`** — `{ "locator": { "role": "button", "name": "Search" } }`
- **`type_by`** — `{ "locator": { "label": "Email" }, "text": "a@b.com" }`
- **`select_by`** — `{ "locator": { "label": "Country" }, "value": "AU" }`

Locator shape: any of `role+name`, `text`, `testid`, `label`,
`placeholder`, `href`, `dataAttr: { key, value }`, or `stableId`. Add
`nth` for the Nth match.

## Observation

- **`find_elements`** — CSS-selector listing.
  `{ "selector": "a[data-product]", "includeText": true }`
- **`get_dropdown_options`** — List `<option>` labels/values for a
  `<select>` at `[index]`. `{ "index": 9 }`
- **`find_text`** — Find first occurrence of a literal string and report
  position. `{ "text": "Sign in" }`
- **`search_page`** — Pattern (literal or regex) search with context
  windows. `{ "pattern": "Order #\\d+", "regex": true }`
- **`extract_content`** — Run LLM-friendly content extraction.
  `{ "query": "all job titles and links", "extractLinks": true }`
- **`screenshot`** — PNG of viewport (or full page). `{ "fileName": "shot.png" }`
- **`save_as_pdf`** — Print current page to PDF.
  `{ "fileName": "page.pdf", "printBackground": true }`

## Control

- **`wait`** — Sleep `ms` milliseconds (max 10_000). `{ "ms": 500 }`
- **`wait_for_text`** — Block until `text` appears (default 30s timeout).
  `{ "text": "Results", "timeoutMs": 10000 }`
- **`focus_area`** — Hint a region for subsequent snapshots, e.g. `"search
form"`. Pass `clear: true` to drop focus. `{ "query": "results list" }`
- **`done`** — Terminate the agent loop with a verdict.
  `{ "success": true, "summary": "Extracted 5 jobs.", "data": {...} }`
