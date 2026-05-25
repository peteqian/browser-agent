# Troubleshooting

## Chrome / CDP

- Connection failure: inspect launch + discovery in `src/cdp/launch.ts` and `src/cdp/discovery.ts`. Confirm a compatible Chrome binary can start.
- Args / flags: `src/cdp/chrome-args.ts`.
- WS client + reconnect logic: `src/cdp/client.ts`.

## MCP

- Server startup failure: `src/mcp/server.ts` and the `browser-agent-mcp` bin entry (`bin/mcp.ts`).
- Tool handler errors: `src/mcp/tools/*`.

## Contract imports

If contract imports fail in another package, verify the type is exported from
`src/index.ts` and consumed from `@peteqian/browser-agent-sdk` — not redefined
locally.

## Typecheck OOM / stack overflow

Symptoms: `SIGABRT`, repeating frame addresses in the trace. Causes seen so far:

- Stale `.tsbuildinfo` after dependency removal. Fix: `rm .tsbuildinfo*` and rerun.
- React 19 × ink global JSX augmentation. Fixed by removing TUI. If reintroducing UI, prefer non-ink, or pin `@types/react@^18`.

## CI fails on a file that passes locally

- Stale buildinfo locally — delete `.tsbuildinfo*` and rerun.
- Working tree has uncommitted changes the committed version doesn't have. CI checks `HEAD`. Stash and rerun against clean tree to reproduce.
