# Watchdogs

Status: ACTIVE. Runtime reliability watchdog work starts with navigation health reporting.

## Goal

Add small local watchdogs that improve reliability without turning the runtime into a hosted platform.

## Completed Slice: Navigation Watchdog

Navigation health is already partially implemented in `Page.goto()` and `Page.navigateWithHealthCheck()`. Formalize that path before introducing a generic watchdog framework.

### Current Code

- `Page.goto()` has a hardcoded navigation timeout and polls `document.readyState`.
- `Page.navigateWithHealthCheck()` detects likely empty pages and retries once.
- `executeAction(navigate)` already converts unhealthy navigation into an action failure.
- `BrowserSession.eventBus` and `AgentEvent.browser_event` already provide the event surface.

### Completed

- [x] Keep `Page.goto()` returning `Promise<void>` to preserve callers.
- [x] Enrich `NavigationHealthResult` with status, original URL, final URL, ready state, duration, and warning details.
- [x] Emit a `browser_event` named `navigation_watchdog` from health-checked navigation.
- [x] Include `data: { navigation: health }` in navigate action results.
- [x] Move `runAgent()` browser event subscription before `startUrl` so startup navigation events are observable.
- [x] Add focused tests for result shaping, empty-page detection, navigate action data, and event emission.

### Avoid In First Slice

- Generic `WatchdogManager`.
- New public options.
- Download tracking.
- Permission grants.
- Storage state save/restore.
- Crash watchdog extraction.
- Artifact directory configuration.

## Completed Slice: Crash / Dead Websocket Events

Use existing `CDPClient.onClose()` and `BrowserSession.reconnectIfNeeded()` paths. Do not extract reconnect ownership yet.

### Completed

- [x] Emit `cdp_disconnected` when the websocket closes unexpectedly.
- [x] Emit `cdp_reconnect_started` when reconnect handling begins.
- [x] Emit `cdp_reconnect_attempt` for each attempt, with attempt count and ownership data.
- [x] Emit `cdp_reconnected` after a successful reconnect.
- [x] Emit `cdp_reconnect_failed` after exhausting attempts or when reconnect is disabled.
- [x] Keep reconnect logic in `BrowserSession`.

## Completed Slice: Dialog / Popup Event Cleanup

Keep current inline `Page.javascriptDialogOpening` handling, but improve event data.

### Completed

- [x] Resolve `targetId` from `sessionId`.
- [x] Emit `javascript_dialog` with dialog type, accepted/dismissed policy result, and original CDP payload.
- [x] Keep dialog handling non-crashing.

## Completed Slice: Downloads

Track `Browser.downloadWillBegin` and `Browser.downloadProgress`, then surface completed paths through browser events.

### Completed

- [x] Add an explicit local `downloadsDir` option before enabling downloads.
- [x] Configure `Browser.setDownloadBehavior` only when download tracking is enabled.
- [x] Emit `download_started`, `download_progress`, `download_completed`, and `download_failed` events.
- [x] Prefer event-only reporting first; action correlation remains deferred until reliable.

## Completed Slice: Permissions

Grant configured browser permissions through the profile/launch config without enabling anything by default.

### Completed

- [x] Add explicit `permissionGrants` profile/launch configuration.
- [x] Configure grants with `Browser.grantPermissions` during session connection.
- [x] Emit `permissions_watchdog_enabled` for successful grants.
- [x] Emit `permissions_watchdog_failed` and `browser_error` when grants fail without crashing session startup.
- [x] Add focused unit tests and an opt-in local geolocation permission integration test.

## Follow-Up Watchdogs

Implement these only after defining caller needs and persistence shapes.

### Storage State

Add only after defining caller needs and persistence shape. Cookies and local/session storage require different mechanisms.

## Candidate Watchdogs

- Crash watchdog: detect closed targets or dead websocket.
- Popup watchdog: surface or close unexpected popups based on policy.
- Download watchdog: detect new downloaded files and attach them to action results.
- Permission watchdog: grant configured local permissions.
- Storage watchdog: save and restore local storage/cookies when configured.
- Screenshot watchdog: capture screenshots for step history.
- Navigation watchdog: detect stalled page loads and network idle timeouts.

## Excluded Watchdogs

- Cloud CAPTCHA solver watchdog.
- Proxy rotation watchdog.
- Hosted anti-bot/stealth watchdog.

## Acceptance Criteria

- Watchdog events use existing `browser_event` surfaces.
- Action-triggered watchdog results are also available in `ActionResult.data`.
- Watchdog events are reflected in step results or browser state.
- Failures are observable but do not crash unrelated agent logic.
- No hosted browser, proxy, CAPTCHA solver, or external telemetry features.
