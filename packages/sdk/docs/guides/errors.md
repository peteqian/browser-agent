# Errors and recovery

## Terminal reasons

`AgentResult.reason` is one of:

| Reason             | Meaning                                                                  | Common cause                                                                                   |
| ------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `done`             | Model emitted `done` action. `success` reflects the model's claim.       | Normal termination.                                                                            |
| `max_failures`     | Consecutive failures hit `maxFailures`.                                  | Bad selectors, broken page, missing auth on the target site. Inspect last few `action` events. |
| `step_timeout`     | DOM serialization or page-context prep took longer than `stepTimeoutMs`. | Slow page, infinite redirects, heavy JS. Raise `--step-timeout`.                               |
| `schema_violation` | Terminal `done` payload didn't match `outputSchema`.                     | Model returned unexpected data shape. `data` is `null`.                                        |
| `aborted`          | `signal` aborted or `control.stop()` called.                             | User cancellation / external timeout.                                                          |
| `loop_detected`    | Same fingerprint repeated `loopDetectionWindow` times.                   | Model stuck. Check the page or refine the task.                                                |

## "No transport available"

```
No transport available for provider=claude in env=local. Tried: sdk-agent, cli, sdk-api.
```

Cause: every transport probe failed. Each rejected attempt is logged to stderr first as `transport_unavailable`. Read those reasons:

```sh
browser-agent --probe --provider claude
```

Common fixes:

- `sdk-agent: no ANTHROPIC_API_KEY or ~/.claude/.credentials.json` → run `claude login` or set `ANTHROPIC_API_KEY`.
- `cli: \`claude\` not found on PATH`→ install Claude CLI or set`CLAUDE_BIN`.
- `sdk-api: ANTHROPIC_API_KEY not set` → export the env var.

## Decision parse failures

Adapter throws `Decision response missing action name` or similar. Cause: the model returned text that wasn't valid JSON or didn't include `name`. Mitigation:

- Lower temperature for `openai` / `anthropic` providers (already 0.2 default).
- For freeform adapters (CLI/SDK), the prompt explicitly asks for raw JSON; failures usually indicate the model wrapped output in extra prose. The parser tolerates code fences and balanced JSON within prose, but completely off-script output throws.
- Pass `onCodexRaw` (or use `--verbose`) to log raw output and see what the model actually said.

## Action timeouts

```
Action timed out after 30000ms
```

The action ran longer than `actionTimeoutMs`. Common when:

- Navigating to a slow site (raise `--action-timeout`).
- `wait_for_text` is hunting text that never appears.
- Page is in an infinite redirect.

The next decision sees the timeout in history; the model can recover by trying a different action.

## Loop detection

The loop tracks an action+result fingerprint per step. If the same fingerprint appears `loopDetectionWindow` times in a row (default 4), the loop terminates with `loop_detected`. To disable, pass `loopDetectionMode: "off"`.

## Cancellation

```ts
const controller = new AbortController();
runTask({ ..., signal: controller.signal });

// Later:
controller.abort();
```

The loop terminates at the next safe point. The browser session is closed if the loop owned it; otherwise it stays for the caller to clean up.

`AgentController` provides cooperative pause / resume / stop:

```ts
const control = new AgentController();
runTask({ ..., control });

control.pause();         // freezes between steps
control.resume();
control.stop("user");    // ends with reason: "aborted", summary: "user"
```

## Browser launch failures

Chrome for Testing must be discoverable or installable. The launcher tries
`BROWSER_AGENT_CHROME`, then the managed Chrome for Testing cache, then installs
it when auto-install is enabled. If you see "Chrome not found":

- Set `BROWSER_AGENT_CHROME=/full/path/to/chrome`.
- Or pass `launch: { executablePath: "..." }` to `runTask(...)`.

## Reading the verbose log

`--verbose` writes JSONL to stderr:

```
{"event":"agent.step","data":{...}}
{"event":"model.raw","data":{"step":3,"raw":"..."}}
```

Combine with `--json` to capture both event stream (stdout) and raw model output (stderr).
