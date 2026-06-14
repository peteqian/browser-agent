<div align="center">

# @peteqian/browser-agent-sdk

### Hands and eyes for your model.

TypeScript browser-automation SDK. Raw Chrome DevTools Protocol + an LLM decision loop. Domain-agnostic. The library core consumed by `@peteqian/browser-agent` (CLI + MCP).

[![npm](https://img.shields.io/npm/v/@peteqian/browser-agent-sdk.svg)](https://www.npmjs.com/package/@peteqian/browser-agent-sdk)
[![CI](https://github.com/peteqian/browser-agent/actions/workflows/ci.yml/badge.svg)](https://github.com/peteqian/browser-agent/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Types: TypeScript](https://img.shields.io/badge/types-typescript-blue.svg)](#)

</div>

---

## Why

Your model can reason, plan, write code. It can't open a tab, dismiss a cookie banner, click "Continue with Google", or scroll past a paywall. This package gives it that reach.

- **Raw CDP, no Puppeteer/Playwright in the chain.** Smaller surface, fewer fingerprints, faster startup.
- **Bring any model.** OpenAI, Anthropic, Codex CLI, Codex Agent SDK, Claude CLI, Claude Agent SDK — or your own `getNextAction`.
- **Built-in MCP server.** Drop into Claude Desktop, Cursor, or any MCP client without writing glue.
- **First-class CLI.** `browser-agent "task..."` and go.
- **Vision when it helps.** Screenshots forwarded to multimodal endpoints automatically.
- **Typed terminal output.** `done(data=...)` validated against a Zod schema.
- **Resilient loop.** Loop detection, step + decision timeouts, abort/stop control, head+tail history compaction.

## Benchmark

10 tasks across 5 categories; identical task list and judge on both sides. Different driver models. See [`bench/`](https://github.com/peteqian/browser-agent/tree/main/packages/sdk/bench) for methodology, per-task verdicts, raw bundles, and the comparison chart.

## Install

```bash
npm install @peteqian/browser-agent-sdk
# or
bun add @peteqian/browser-agent-sdk
```

Requirements: **Node ≥ 18** or **Bun ≥ 1.3** + any Chrome-based browser.

## Quickstart

```ts
import { Browser, runTask } from "@peteqian/browser-agent-sdk";

const browser = new Browser();

try {
  const result = await runTask({
    task: "Go to example.com and report the H1 text.",
    browser,
    startUrl: "https://example.com",
  });
  console.log(result.summary);
} finally {
  await browser.close();
}
```

That's it. Default provider auto-resolves to whatever's signed in locally (Codex → Claude → OpenAI/Anthropic by API key).
Use `browser.close()` for normal cleanup. If the browser is wedged or an
external challenge flow leaves Chrome hanging, use `browser.kill()` to force
kill the launched browser process tree.

Chrome launches in CDP debug mode by default. For authenticated one-shot tasks,
use a named profile and keep the task as the only thing the agent has to solve:

```ts
const result = await runTask({
  task: "Check my Gmail inbox and summarize unread messages.",
  profile: "gmail",
  headless: false,
});
```

The profile is stored under `~/.browser-agent/profiles/gmail/` and reuses
cookies/localStorage on later runs.

For real-browser challenge diagnostics, attach to an existing Chrome DevTools
endpoint and preserve the browser's native fingerprint:

```ts
const browser = new Browser({
  cdpUrl: process.env.BROWSER_AGENT_CDP_URL, // http://127.0.0.1:9222 or ws://...
  fingerprintMode: "native",
});

const result = await runTask({
  task: "Run fingerprint_report and summarize the exposed browser signals.",
  browser,
});
```

`native` mode skips the stealth init script and the fixed user-agent/client-hints
override. For owned Chrome launches, it also avoids the broad automation-tuned
default arg set and keeps only the essential DevTools/profile flags plus caller
provided options. It is intended for user-controlled headed/profile browsers
where cookies, storage, IP, and manual interaction need to stay tied to the same
browser identity.

### Fingerprint and humanized input

Pick how the browser presents itself (`stealth` mode only) and make input
trajectories human-like — curved mouse paths, variable typing cadence:

```ts
const browser = new Browser({
  fingerprint: "windows-chrome", // or a partial FingerprintProfile merged over a preset
  humanize: true, // or { mouse: true, typing: true, speed: 1 }
});
```

Presets: `macos-chrome` (default) · `windows-chrome` · `linux-chrome`. A custom
profile can override UA, client hints, languages, timezone, hardware
concurrency, device memory, WebGL vendor/renderer, and screen dimensions — the
init script and `Emulation.setUserAgentOverride` are generated from the same
resolved profile so JS-visible and header-visible signals stay coherent.

### Bot-challenge watchdog

Enabled by default in the agent loop. Before each step the loop detects
Cloudflare interstitials, Turnstile widgets, reCAPTCHA, and hCaptcha; waits for
managed challenges to auto-pass; clicks interactive Turnstile checkboxes with
humanized input; and surfaces unresolved challenges as a `challenge` event plus
an observation note so the model can route around them. Tune or disable via
`challengeWatchdog: { timeoutMs, clickTurnstile } | false`.

### Embedded forms (cross-origin iframes)

Job boards and similar embeds (Greenhouse `job_app`, Workday company-site
embeds) render their forms in out-of-process iframes that plain DOM snapshots
cannot see. The snapshot pipeline detects those iframes, captures their
targets through CDP, translates coordinates into main-page space, and merges
the elements into the observation (`framePath: "oopif:<targetId>"`). Actions
(`click`, `type`, `select_option`, `upload_file`, locator variants) route to
the owning target automatically — verified live against a Greenhouse-embedded
application form. When an iframe target can't be matched, the element keeps a
hint telling the model to navigate to the frame's `src` or use screenshot +
coordinate clicks. Workday's `data-automation-id` attributes are captured as
test ids for durable locators.

### Self-healing actions

When an index-targeted action fails because the page re-rendered between
snapshot and click, the runner re-observes, re-locates the element by stable
identity, and retries once before surfacing the failure. Disable with
`selfHealing: false`.

### OpenTelemetry export

`reportToOtel(report)` maps a `RunReport` to dependency-free OTel-shaped spans
(`run → step → snapshot/decision/action`) and metrics (tokens, cost, duration,
challenges). Forward to any backend (Datadog, Tempo, Honeycomb) without this
package pulling in `@opentelemetry/*`:

```ts
import { RunReportCollector, reportToOtel } from "@peteqian/browser-agent-sdk";

const collector = new RunReportCollector({ task });
await runTask({ task, browser, onEvent: collector.onEvent });
const { spans, metrics } = reportToOtel(collector.build());
// hand spans/metrics to your exporter
```

### Applicant autofill + answer bank

Job-application forms repeat the same fields. `planAutofill` matches a
declarative `ApplicantProfile` (name, email, phone, resume path, links, custom
Q&A) against the snapshot's form elements and returns deterministic fills —
turning most of an application into cheap typed actions instead of LLM
reasoning. `AnswerBank` caches free-form answers (keyed by question text) so
repeated applications reuse them.

```ts
import { planAutofill, autofillActions, AnswerBank } from "@peteqian/browser-agent-sdk";

const bank = new AnswerBank(savedAnswers);
const fills = planAutofill(
  { firstName: "Ada", email: "ada@x.com", resumePath: "/cv.pdf" },
  state.elements,
  bank,
);
const actions = autofillActions(fills); // type / select_option / upload_file
```

### Trace / replay bundle

`TraceRecorder` writes per-step screenshot + observation + decision + action
result to a directory plus a self-contained `index.html` timeline — replay
exactly what the agent saw when a CI run fails, no live browser needed.

```ts
const tracer = new TraceRecorder({ dir: "./traces/run-1" });
await runTask({ task, browser, onEvent: tracer.onEvent });
tracer.finalize(); // writes trace.json + index.html
```

### Captcha solver plugin

The challenge watchdog auto-passes Cloudflare and clicks Turnstile; for
reCAPTCHA / hCaptcha that need a real solve, plug in a `CaptchaSolver`
(2captcha, CapSolver, or a human handoff). The watchdog parses the site key,
calls your solver, injects the returned token, and re-checks.

```ts
await runTask({
  task,
  browser,
  challengeWatchdog: {
    solver: {
      async solve({ vendor, siteKey, url }) {
        /* ... */ return { solved: true, token };
      },
    },
  },
});
```

### Proxy rotation

`ProxyPool` rotates egress IPs across launches (round-robin, random,
sticky-per-host) for high-volume scraping. Note this rotates the network IP,
not Chrome's TLS/JA3 fingerprint — point pool entries at a uTLS-style proxy if
you need that layer.

### PII redaction

`redactReport` / `redactString` / `redactValue` scrub emails, phones, and
caller-supplied secret values from reports, logs, and events before you ship
them as CI artifacts.

### Rate limiting and post-conditions

`rateLimit: { perActionMs, perHostMs }` adds politeness delays between actions
to avoid volume bot heuristics. Per-action `postCondition` assertions
(`url_changed`, `element_gone`, `text_present`, …) verify the page reached the
expected state and downgrade silent no-ops to failures without a full
re-observe.

### CI/CD run reports and cost budgets

```ts
import { RunReportCollector, toJUnitXml, runTask } from "@peteqian/browser-agent-sdk";

const collector = new RunReportCollector({ task });
const result = await runTask({
  task,
  browser,
  onEvent: collector.onEvent,
  budget: { maxCostUsd: 0.5, maxTokens: 500_000 }, // optional hard ceiling → reason: "budget_exceeded"
});

const report = collector.build(); // stable JSON: steps, actions, tokens, cost, challenges
await Bun.write("report.json", JSON.stringify(report, null, 2));
await Bun.write("report.junit.xml", toJUnitXml(report)); // for CI test-report ingestion
```

`report.usage` aggregates tokens (incl. cache reads/writes) and `report.costUsd`
prices them per model (`DEFAULT_MODEL_PRICING`, overridable via `pricing`).

### Pin a provider

```ts
await runTask({
  task: "Find the top Hacker News story.",
  browser,
  startUrl: "https://news.ycombinator.com",
  llm: { provider: "openai", model: "gpt-4.1-mini" },
});
```

### Typed terminal output

```ts
import { z } from "zod";
import { Browser, runTask } from "@peteqian/browser-agent-sdk";

const Result = z.object({ heading: z.string() });

const browser = new Browser();

try {
  const result = await runTask({
    task: "Report the page heading via done(data=...).",
    browser,
    startUrl: "https://example.com",
    outputSchema: Result,
  });

  if (result.success) console.log(result.data?.heading);
} finally {
  await browser.close();
}
```

### Drive the browser directly

```ts
import { Browser } from "@peteqian/browser-agent-sdk";

const browser = new Browser();
const page = await browser.newPage();
await page.goto("https://example.com");
console.log(await page.title());
await browser.close();
```

## CLI and MCP

The CLI (`browser-agent`) and MCP server (`browser-agent-mcp`) ship in the sibling runtime package `@peteqian/browser-agent` — install that package if you want the bins.

The anti-bot, pacing, and observability features above are surfaced on both:

```bash
browser-agent "Apply to the job at this URL" --url https://jobs.example.com/apply \
  --proxy http://1.2.3.4:8080 \
  --rate-limit-ms 250 --rate-limit-host-ms 1000 \
  --report-json ./run-report.json --trace-dir ./trace --redact
```

`--report-json` writes a structured `RunReport` (steps, tokens, cost, challenges) for CI;
`--trace-dir` writes a replayable screenshot timeline (`index.html`); `--redact` scrubs
PII from the report. The MCP `run_agent` tool takes the same knobs as params
(`proxy`, `proxyBypass`, `rateLimitMs`, `rateLimitHostMs`, `includeReport`, `redact`) —
with `includeReport: true` it returns the `RunReport` inline in the tool result.

## Providers

| Flag                           | Backend                                       | Auth                                     |
| ------------------------------ | --------------------------------------------- | ---------------------------------------- |
| `--provider codex` _(default)_ | Codex Agent SDK → Codex CLI                   | `codex` signed in                        |
| `--provider claude`            | Claude Agent SDK → Claude CLI → Anthropic API | `claude` signed in / `ANTHROPIC_API_KEY` |
| `--provider openai`            | OpenAI Chat Completions                       | `OPENAI_API_KEY`                         |
| `--provider anthropic`         | Anthropic Messages                            | `ANTHROPIC_API_KEY`                      |

`--base-url` overrides the SDK base URL (OpenAI-compatible endpoints, local servers, gateways).

## Actions

The model emits actions from this catalog (full schemas in `src/actions/types.ts`):

`navigate` · `click` · `click_by` · `dblclick` · `hover` · `focus` · `focus_area` · `type` · `type_by` · `fill` · `scroll` · `wait` · `send_keys` · `press` · `keyboard_type` · `select_option` · `select_by` · `upload_file` · `wait_for_text` · `go_back` · `go_forward` · `refresh` · `new_tab` · `switch_tab` · `close_tab` · `close_browser` · `search_page` · `find_elements` · `find_by_role` · `find_by_text` · `find_by_testid` · `get_dropdown_options` · `find_text` · `screenshot` · `save_as_pdf` · `extract_content` · `eval` · `dialog_handle` · `network_har_start` · `network_har_stop` · `profiler_start` · `profiler_stop` · `done`

Add your own via `createDefaultActionRegistry()` + custom `ActionDefinition`.
See [`examples/custom-action.ts`](./examples/custom-action.ts).

## `AgentResult`

- `success` — `true` only when `reason === "completed"`.
- `reason` — branch on this in production: `completed`, `failed`, `max_failures`, `loop_detected`, `aborted`, `stopped`, `step_timeout`, `decision_timeout`, `schema_violation`, `decide_error`, `budget_exceeded`.
- `summary` — human-readable, not for control flow.
- `data` — `TData | null`, validated against `outputSchema`.
- `steps` — iterations executed.

## Internal subpath

Anything beyond the public surface lives under `/internal` and carries **no stability guarantee**:

```ts
import { CDPClient, launchBrowser, executeAction } from "@peteqian/browser-agent-sdk/internal";
```

## Development

Repo is a Bun + Turbo monorepo — see the root `README.md` for setup.

```bash
bun install
bun run build         # turbo build (sdk + cli)
bun run typecheck
bun run test
```

SDK-only commands:

```bash
bun --cwd packages/sdk run build
bun --cwd packages/sdk run test
bun --cwd packages/sdk run typecheck:examples
```

Examples:

- [`examples/goto.ts`](./examples/goto.ts) — drive a page directly with `BrowserSession`.
- [`examples/simple-agent.ts`](./examples/simple-agent.ts) — use `runTask` with a reusable `Browser`.
- [`examples/agent.ts`](./examples/agent.ts) — run one task with the default SDK wrapper.
- [`examples/typed-output.ts`](./examples/typed-output.ts) — validate terminal `done(data=...)` with Zod.
- [`examples/custom-action.ts`](./examples/custom-action.ts) — register a typed custom action.
- [`examples/remote-cdp.ts`](./examples/remote-cdp.ts) — attach to an existing DevTools endpoint.
- [`examples/extraction.ts`](./examples/extraction.ts) — chunk and dedupe extracted page content.
- [`examples/downloads.ts`](./examples/downloads.ts), [`examples/upload.ts`](./examples/upload.ts), and [`examples/storage-state.ts`](./examples/storage-state.ts) cover local browser workflows.
- [`examples/seek-apply.ts`](./examples/seek-apply.ts) — search and apply on SEEK with a saved profile.
- [`examples/seek-signed-in-task.ts`](./examples/seek-signed-in-task.ts) — reuse a signed-in SEEK profile via `runTask`.
- [`examples/seek-signed-in-session.ts`](./examples/seek-signed-in-session.ts) — low-level `BrowserSession` with a signed-in profile.

The MCP example lives in [`packages/cli/examples/mcp.ts`](../cli/examples/mcp.ts).

## For AI agents

Skip this README — read [`docs/ai/`](./docs/ai/README.md) instead. It splits architecture, contracts, commands, conventions, and troubleshooting into focused files. `AGENTS.md` and `CLAUDE.md` at the root are thin pointers to the same folder.

## License

[MIT](./LICENSE) © Peter Qian
