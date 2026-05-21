# SDK guide

`@peteqian/browser-agent-sdk` is consumable as a library from any Node.js or Bun program.

## Minimal example

```ts
import { createDecide, runAgent } from "@peteqian/browser-agent-sdk";

const { decide, resolution } = createDecide({ provider: "codex" });

const result = await runAgent({
  task: "Open example.com and report the H1",
  decide,
  transportResolution: resolution,
});

console.log(result);
```

`createDecide` returns `{ decide, resolution }`:

- `decide` — pass to `runAgent` as `decide`.
- `resolution` — pass as `transportResolution` so the loop emits `transport_resolved` to your `onEvent` listener.

## Choosing an adapter directly

Skip `createDecide` if you want explicit control:

```ts
import { createOpenAIDecide, runAgent } from "@peteqian/browser-agent-sdk";

const decide = createOpenAIDecide({
  model: "gpt-4.1-mini",
  apiKey: process.env.OPENAI_API_KEY,
});

await runAgent({ task: "...", decide });
```

Available factories: `createOpenAIDecide`, `createAnthropicDecide`, `createCodexCliDecide`, `createCodexSdkDecide`, `createClaudeCliDecide`, `createClaudeSdkDecide`.

## Typed terminal output

Pass a Zod schema and the loop validates the model's `done(data=...)` payload, narrowing `result.data`:

```ts
import { z } from "zod";
import { createDecide, runAgent } from "@peteqian/browser-agent-sdk";

const schema = z.object({
  jobs: z.array(z.object({ title: z.string(), url: z.string().url() })),
});

const { decide, resolution } = createDecide({ provider: "codex" });

const result = await runAgent({
  task: "Find top 5 frontend jobs on seek.com.au",
  startUrl: "https://seek.com.au",
  decide,
  transportResolution: resolution,
  outputSchema: schema,
});

if (result.success) {
  // result.data is z.infer<typeof schema>
  for (const job of result.data.jobs) console.log(job.title);
}
```

If the model's payload fails validation, the result is `{ success: false, reason: "schema_violation", data: null }`.

## Observing the run

```ts
await runAgent({
  task: "...",
  decide,
  transportResolution: resolution,
  onEvent: (event) => {
    switch (event.type) {
      case "transport_resolved":
        console.log("transport:", event.resolution.transport);
        break;
      case "decision":
        console.log(`step ${event.step}: ${event.decision.actions[0]?.name}`);
        break;
      case "action":
        console.log(`  -> ${event.action.name}: ${event.result.message}`);
        break;
      case "terminal":
        console.log("done:", event.result.summary);
        break;
    }
  },
});
```

`onEvent` is awaited — return a Promise to backpressure the loop (useful for streaming to a database / SSE channel).

See [Events guide](./events.md) for the full event shape.

## Cancellation

Two paths:

```ts
// Hard cancel.
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000);

await runAgent({ task: "...", decide, signal: controller.signal });
```

```ts
// Cooperative — pause / resume / stop.
import { AgentController } from "@peteqian/browser-agent-sdk";

const control = new AgentController();
const promise = runAgent({ task: "...", decide, control });

control.pause();
control.resume();
control.stop("user canceled");

await promise;
```

When `control.stop()` is called or `signal` aborts, the loop terminates at the next safe point and resolves with `result.reason === "aborted"` (or whatever reason was passed).

## Reusing a browser

By default `runAgent` launches and tears down a Chrome process. To keep a session alive across runs:

```ts
import { BrowserSession, runAgent } from "@peteqian/browser-agent-sdk";

const session = await BrowserSession.launch({ headless: true });
const page = await session.newPage();

await runAgent({ task: "first task", decide, session, page });
await runAgent({ task: "second task", decide, session, page });

await session.close();
```

When you pass `session` and/or `page`, the loop will not own their lifecycle.

## Forcing a transport

```ts
const { decide, resolution } = createDecide({
  provider: "claude",
  transport: "sdk-api", // skip CLI / agent SDK fallback
  env: "cloud", // disable local-only paths
});
```

See [Transports guide](./transports.md) for the full priority chain.

## Versioning

```ts
import { VERSION, PACKAGE_NAME } from "@peteqian/browser-agent-sdk";
console.log(`${PACKAGE_NAME} ${VERSION}`);
```

## Internals

`@peteqian/browser-agent-sdk/internal` exposes raw CDP, DOM serialization, action schemas, and the prompt builder. These have no stability guarantee and may change without a minor version bump.

## Examples

- [`examples/custom-action.ts`](../../examples/custom-action.ts) shows how to add a typed action with `ActionDefinition` and `ActionResult`.
