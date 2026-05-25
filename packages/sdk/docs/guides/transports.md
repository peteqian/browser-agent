# Transports

A "transport" is the mechanism the agent uses to reach an LLM. Three kinds:

| Transport   | What                                                                                                                                     |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `sdk-agent` | A vendor's Agent SDK (e.g. `@anthropic-ai/claude-agent-sdk`, `@openai/codex-sdk`). Best when available — runs in-process, no spawn cost. |
| `sdk-api`   | The vendor's plain REST API SDK (`openai`, `@anthropic-ai/sdk`). Always available given an API key.                                      |
| `cli`       | The vendor's CLI binary (`codex`, `claude`). Used when the SDK isn't viable but a logged-in CLI is.                                      |

## Resolution flow

`resolveTransport()` picks the best transport for the runtime environment. It is called automatically by `createDecide()`.

```
detectEnv()                  → local | cloud
                                  │
provider × env → ordered chain    │
                                  ▼
for each candidate:
  probeTransport()        → ok? reason?
      sdk-agent: explicit API key, env API key, OR auth file present
      cli:       binary on PATH
      sdk-api:   explicit API key OR env API key present
                                  │
   first ok → buildDecide()       │
                                  ▼
                         { decide, resolution }
```

## Priority chain

| Provider    | env=local                       | env=cloud       |
| ----------- | ------------------------------- | --------------- |
| `codex`     | `sdk-agent` → `cli`             | (none — throws) |
| `claude`    | `sdk-agent` → `cli` → `sdk-api` | `sdk-api`       |
| `openai`    | `sdk-api`                       | `sdk-api`       |
| `anthropic` | `sdk-api`                       | `sdk-api`       |

Cloud disables CLI / agent-SDK paths because they assume binaries + auth files on disk that won't be present in a typical container.

## Detecting cloud

`detectEnv()` priority:

1. Explicit `env: "local" | "cloud"` (override).
2. `BROWSER_AGENT_ENV=local|cloud` env var.
3. Common cloud markers: `KUBERNETES_SERVICE_HOST`, `AWS_LAMBDA_FUNCTION_NAME`, Vercel, Fly, Railway, Cloud Run (`GOOGLE_CLOUD_PROJECT` + `K_SERVICE`).
4. Default: `local`.

## Forcing a specific transport

```ts
createDecide({
  provider: "claude",
  transport: "sdk-api", // try only this transport
});
```

Forced transports still run their probe checks. For example, forcing
`sdk-api` still requires an explicit `apiKey` option or the matching API-key
environment variable.

Useful when:

- You want deterministic behavior in CI.
- You want to bypass a misbehaving CLI without uninstalling it.
- You're testing a specific path.

## Probing without running

```sh
browser-agent --probe --provider claude
```

Prints the resolution JSON:

```json
{
  "provider": "claude",
  "env": "local",
  "transport": "cli",
  "fallbackFrom": "sdk-agent",
  "fallbackReason": "claude sdk-agent: no ANTHROPIC_API_KEY or ~/.claude/.credentials.json",
  "durationMs": 9
}
```

## Observing resolution at runtime

When you pass `transportResolution` to `runTask`, a `transport_resolved` event fires before step 1:

```ts
import { createDecide, runTask } from "@peteqian/browser-agent-sdk";

const { decide, resolution } = createDecide({ provider: "codex" });

await runTask({
  task: "...",
  getNextAction: decide,
  transportResolution: resolution,
  onEvent: (event) => {
    if (event.type === "transport_resolved") {
      console.log(event.resolution);
    }
  },
});
```

## Logs

`resolveTransport()` writes structured JSON to stderr for both the chosen transport and any rejected fallbacks:

```
{"event":"browser_agent.transport_unavailable","provider":"claude","transport":"sdk-agent","reason":"..."}
{"event":"browser_agent.transport_resolved","provider":"claude","env":"local","transport":"cli","fallbackFrom":"sdk-agent",...}
```

Pipe stderr through your structured logger of choice.
