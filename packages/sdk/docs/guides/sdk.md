# SDK guide

`@peteqian/browser-agent-sdk` is consumable as a library from any Node.js or Bun
program. The common path is intentionally one shape: pass one task to
`runTask(...)`.

## Minimal example

```ts
import { runTask } from "@peteqian/browser-agent-sdk";

const result = await runTask({
  task: "Open example.com and report the H1",
});

console.log(result.summary);
```

By default the agent auto-resolves a local model transport, preferring signed-in
Codex / Claude paths before API-key providers.

Managed Chrome launches with CDP debugging enabled by default. You do not need a
separate debug-mode option for normal agent runs.

## Authenticated one-shot tasks

Use a named profile when a task needs login state:

```ts
import { runTask } from "@peteqian/browser-agent-sdk";

const result = await runTask({
  task: "Check my Gmail inbox and summarize unread messages.",
  profile: "gmail",
  headless: false,
});
```

The first run creates `~/.browser-agent/profiles/gmail/`; later runs reuse its
cookies and localStorage. This keeps the public flow as a single task call while
keeping profile reuse explicit.

## Choosing an adapter directly

Use `llm` when you want explicit provider/model control:

```ts
import { runTask } from "@peteqian/browser-agent-sdk";

await runTask({
  task: "Find the top Hacker News story.",
  startUrl: "https://news.ycombinator.com",
  llm: { provider: "openai", model: "gpt-4.1-mini" },
});
```

For a fully custom decision function, pass `getNextAction`:

```ts
await runTask({
  task: "...",
  getNextAction: async (input) => ({
    done: true,
    success: true,
    summary: `Saw ${input.observation.length} chars of page state.`,
    actions: [{ name: "done", params: { success: true, summary: "done" } }],
  }),
});
```

Available factories for advanced callers: `createOpenAIDecide`,
`createAnthropicDecide`, `createCodexCliDecide`, `createCodexSdkDecide`,
`createClaudeCliDecide`, `createClaudeSdkDecide`, and `createDecide`.

## Typed terminal output

Pass a Zod schema and the loop validates the model's `done(data=...)` payload,
narrowing `result.data`:

```ts
import { z } from "zod";
import { runTask } from "@peteqian/browser-agent-sdk";

const schema = z.object({
  jobs: z.array(z.object({ title: z.string(), url: z.string().url() })),
});

const result = await runTask({
  task: "Find top 5 frontend jobs on seek.com.au",
  startUrl: "https://seek.com.au",
  outputSchema: schema,
});

if (result.success) {
  for (const job of result.data.jobs) console.log(job.title);
}
```

If the model's payload fails validation, the result is
`{ success: false, reason: "schema_violation", data: null }`.

## Observing the run

```ts
await runTask({
  task: "...",
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

`onEvent` is awaited, so returning a Promise backpressures the loop. See
[Events guide](./events.md) for the full event shape.

## Cancellation

Hard cancel:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 30_000);

await runTask({ task: "...", signal: controller.signal });
```

Cooperative pause / resume / stop:

```ts
import { AgentController, runTask } from "@peteqian/browser-agent-sdk";

const control = new AgentController();
const promise = runTask({ task: "...", control });

control.pause();
control.resume();
control.stop("user canceled");

await promise;
```

When `control.stop()` is called or `signal` aborts, the loop terminates at the
next safe point and resolves with `result.reason === "aborted"` or the passed
stop reason.

## Reusing a browser

When the agent owns its browser, it launches and tears down Chrome for the run.
To keep browser state across runs, pass a `Browser` or `BrowserSession`:

```ts
import { Browser, runTask } from "@peteqian/browser-agent-sdk";

const browser = new Browser();

try {
  await runTask({ task: "first task", browser });
  await runTask({ task: "second task", browser });
} finally {
  await browser.close();
}
```

To attach to a browser that is already exposing Chrome DevTools Protocol:

```ts
import { BrowserSession } from "@peteqian/browser-agent-sdk";

const session = await BrowserSession.connect(process.env.BROWSER_AGENT_CDP_URL!);
const page = (await session.listPages())[0] ?? (await session.newPage());

await runTask({ task: "...", session, page });
```

## Forcing a transport

```ts
const result = await runTask({
  task: "...",
  llm: {
    provider: "claude",
    transport: "sdk-api",
    env: "cloud",
  },
});
```

See [Transports guide](./transports.md) for the full priority chain.

## Versioning

```ts
import { VERSION, PACKAGE_NAME } from "@peteqian/browser-agent-sdk";
console.log(`${PACKAGE_NAME} ${VERSION}`);
```

## Internals

`@peteqian/browser-agent-sdk/internal` exposes raw CDP, DOM serialization,
action schemas, and the prompt builder. These have no stability guarantee and
may change without a minor version bump.
