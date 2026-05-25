---
"@peteqian/browser-agent-sdk": patch
"@peteqian/browser-agent": patch
---

Fix eight correctness bugs found in review:

- MCP `run_actions` now runs every action in a caller-supplied batch instead of stopping after the first state-changing one (it previously dropped the rest but reported success).
- `extract_content` no longer rejects a second, differently-queried extraction on the same page as a duplicate.
- The native tool-calling adapter now returns a result for every `tool_call` when a model emits several, avoiding a failed follow-up request.
- Action parse/schema errors are now surfaced back to the model in tool-calling mode so it can correct itself.
- Loop nudge budget is no longer double-consumed when two detectors fire in the same step.
- Chrome version discovery sorts numerically, so the newest installed build is chosen (e.g. 140 over 99).
- `decisionMode` is now plumbed through the SDK `runTask`/`Agent` API, not just the CLI.
- The accessibility-tree snapshot fallback reads node DOM info in parallel instead of one CDP round-trip at a time.

Also fixes Linux Chrome-for-Testing discovery and auto-disables the Chrome sandbox when running as root or in CI so headless launches succeed.
