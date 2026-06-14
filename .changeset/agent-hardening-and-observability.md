---
"@peteqian/browser-agent-sdk": minor
"@peteqian/browser-agent": minor
---

Add anti-bot, observability, and job-application features.

**Anti-bot / human-like navigation**

- Configurable fingerprint API: `fingerprint` preset (`macos-chrome` | `windows-chrome` | `linux-chrome`) or a partial `FingerprintProfile`, with the stealth init script and `Emulation.setUserAgentOverride` generated from one resolved profile so JS- and header-visible signals stay coherent.
- Humanized input (`humanize`): curved bezier mouse paths with jitter, eased step timing, held clicks, and variable typing cadence.
- Bot-challenge watchdog (on by default): detects Cloudflare interstitials / Turnstile / reCAPTCHA / hCaptcha, waits for auto-pass, clicks interactive Turnstile checkboxes, and surfaces unresolved challenges as a `challenge` event + observation note. Pluggable `CaptchaSolver` interface (2captcha / CapSolver / human handoff) with site-key parse + token injection.
- Proxy rotation (`ProxyPool`): round-robin / random / sticky-per-host, wired into `Browser` via `proxyPool`.
- Rate limiting (`rateLimit: { perActionMs, perHostMs }`): politeness delays between actions.

**Embedded forms (job boards)**

- Full out-of-process iframe support: cross-origin iframe targets (Greenhouse / Workday embeds) are captured, coordinate-translated, and merged into the snapshot (`framePath: "oopif:<targetId>"`); `click` / `type` / `select_option` / `upload_file` route to the owning target. `data-automation-id` captured as a test id.
- Applicant autofill (`planAutofill` + `ApplicantProfile` + `AnswerBank`): deterministic form fills matched by label synonyms, with a cache for free-form answers.

**Self-healing & reliability**

- Stale-element self-healing: re-observe, re-locate by stable identity, retry once.
- Post-condition assertions (`postCondition`): verify `url_changed` / `element_gone` / `text_present` / … after an action and downgrade silent no-ops to failures.
- Snapshot reuse and a login-wall watchdog.

**Observability & CI/CD**

- `RunReportCollector` → structured `RunReport` (steps, tokens, cost, challenges) with `toJUnitXml` and `reportToOtel` (OpenTelemetry spans + metrics, dependency-free).
- Cost observability: per-model pricing table + `estimateCostUsd`; `budget: { maxCostUsd, maxTokens }` terminates a run with `reason: "budget_exceeded"`.
- `TraceRecorder`: per-step screenshot + observation replay bundle with an `index.html` timeline.
- PII redaction (`redactReport` / `redactString` / `redactValue`).

**CLI + MCP surfacing**

- New CLI flags: `--proxy` / `--proxy-bypass`, `--rate-limit-ms` / `--rate-limit-host-ms`, `--report-json`, `--trace-dir`, `--redact` (also accepted in `--config`).
- MCP `run_agent` tool gains `proxy`, `proxyBypass`, `rateLimitMs`, `rateLimitHostMs`, `includeReport` (returns the `RunReport` inline), and `redact`.
