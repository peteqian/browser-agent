import { VERSION } from "@peteqian/browser-agent-sdk";

import { ENGINES, ENVS, PROVIDERS, TRANSPORTS } from "./agent-task-options";

export function printHelp(): void {
  console.log(`browser-agent ${VERSION} — run a browser task with an LLM agent.

Usage:
  browser-agent "<task>" [flags]
  browser-agent browser status              # check browser executable
  browser-agent browser install             # install Chrome for Testing
  browser-agent install [--help]              # configure MCP clients
  browser-agent dashboard [--port 3217]       # run local HTTP dashboard
  browser-agent profile <subcommand> [--help] # manage persistent profiles
  browser-agent state <subcommand> [--help]   # manage saved-state vault
  browser-agent --stdin                       # read task from stdin
  browser-agent --probe --provider <p>        # show what transport would resolve
  browser-agent --version                     # print version
  browser-agent --help

Flags:
  --url <url>                Start URL to navigate to before the first step.
  --no-headless              Show the browser window.
  --headless                 Run headless (default).
  --engine <e>               ${ENGINES.join(" | ")}  (default: chrome)
  --auto-consent             Auto-dismiss common cookie/consent banners (default).
  --no-auto-consent          Disable auto consent handling.
  --profile <name>           Named persistent browser profile under ~/.browser-agent.
  --storage-state <path>     Load/save cookies + localStorage at this path.
  --allowed-domains <list>   Comma-separated allowlist (e.g. "example.com,*.api.com").
                             Rejects navigate/new_tab to URLs outside the list.
  --init-script <path>       Path to a JS file injected via Page.addScriptToEvaluateOnNewDocument
                             before every navigation. Repeatable.

Provider:
  --provider <p>             ${PROVIDERS.join(" | ")}  (default: codex)
  --model <id>               Override the default model for the provider.
  --api-key <k>              API key. Prefer env vars over CLI flag.
  --base-url <url>           Base URL for OpenAI-compatible providers.
  --effort <e>               Codex reasoning effort: minimal|low|medium|high|xhigh.

Transport:
  --transport <t>            ${TRANSPORTS.join(" | ")}  (default: auto)
  --decision-mode <m>        tool | json  (default: json). "tool" uses native
                             tool-calling on the openai/codex sdk-api path:
                             one action per turn, lean persistent conversation.
  --env <e>                  ${ENVS.join(" | ")}  (default: auto)

Timeouts (ms):
  --decision-timeout <ms>    Per-decision LLM call timeout (default 120000).
  --step-timeout <ms>        Per-step page-context preparation timeout (default 180000).
  --action-timeout <ms>      Per-action execution timeout (default 30000).
  --max-failures <n>         Consecutive failures before giving up (default 5).

Output:
  --json                     Stream events as JSONL on stdout instead of result blob.
  --output-file <path>       Write final result JSON to file (still printed on stdout).
  --verbose, -v              Print every AgentEvent and step trace as
                             timestamped JSONL on stderr. Composes with --json.
  --summary                  After the run, print a per-step timing table to stdout
                             (decision / snapshot / action breakdown).
  --full-snapshots           Always send the full DOM snapshot instead of a per-step diff.

Other:
  --config <path>            Load defaults from JSON file (CLI flags override).
  --stdin                    Read task from stdin.
  --probe                    Print resolved transport for the provider and exit.
  --version, -V              Print version.
  --help, -h                 This help.

Env vars:
  CODEX_BIN                  Path to codex binary (default: codex).
  CLAUDE_BIN                 Path to claude binary (default: claude).
  OPENAI_API_KEY             Used when --provider=openai|codex SDK and key omitted.
  ANTHROPIC_API_KEY          Used when --provider=anthropic|claude and key omitted.
  BROWSER_AGENT_ENV          Force runtime env: local|cloud.

Examples:
  browser-agent "Go to example.com and report the H1"
  browser-agent "Find top 5 frontend jobs on seek.com.au" --url https://seek.com.au
  browser-agent "Summarize page" --provider openai --model gpt-4.1-mini
  echo "open google.com" | browser-agent --stdin
  browser-agent --probe --provider claude
`);
}
