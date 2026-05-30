# CLI guide

`browser-agent` runs a single task end-to-end and prints the result as JSON.

## Synopsis

```
browser-agent "<task>" [flags]
browser-agent --stdin
browser-agent --probe --provider <p>
browser-agent --version
browser-agent --help
```

## Flags

### Task and run shape

| Flag                           | What                                                     |
| ------------------------------ | -------------------------------------------------------- |
| `--url <url>`                  | Start URL (skips a navigate step).                       |
| `--headless` / `--no-headless` | Hide / show the browser window. Default headless.        |
| `--stdin`                      | Read task from stdin. Combinable with positional task.   |
| `--config <path>`              | Load defaults from JSON file. CLI flags override config. |

### Provider

| Flag               | What                                                                     |
| ------------------ | ------------------------------------------------------------------------ |
| `--provider <p>`   | `codex` (default) / `claude` / `openai` / `anthropic`.                   |
| `--model <id>`     | Override default model.                                                  |
| `--api-key <k>`    | API key. Prefer env vars — flags appear in process listings.             |
| `--base-url <url>` | Base URL for OpenAI-compatible endpoints.                                |
| `--effort <e>`     | Codex reasoning effort: `minimal` / `low` / `medium` / `high` / `xhigh`. |

### Transport resolution

| Flag              | What                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------ |
| `--transport <t>` | Force `auto` / `sdk-agent` / `sdk-api` / `cli`.                                                              |
| `--env <e>`       | Force `auto` / `local` / `cloud`.                                                                            |
| `--probe`         | Resolve transport, print resolution JSON, exit 0. Use this to debug auth issues without launching a browser. |

### Timeouts

| Flag                      | Default | What                                   |
| ------------------------- | ------- | -------------------------------------- |
| `--decision-timeout <ms>` | 120000  | One LLM call.                          |
| `--step-timeout <ms>`     | 180000  | Per-step page-context preparation.     |
| `--action-timeout <ms>`   | 30000   | Single action execution.               |
| `--max-failures <n>`      | 5       | Consecutive failures before giving up. |

### Output

| Flag                   | What                                                                  |
| ---------------------- | --------------------------------------------------------------------- |
| `--json`               | Stream `AgentEvent`s as JSONL on stdout instead of the result blob.   |
| `--output-file <path>` | Write final result JSON to file. Stdout still prints unless `--json`. |
| `--verbose` / `-v`     | Print raw model output and step traces to stderr (JSONL).             |

## Env vars

| Var                 | What                                              |
| ------------------- | ------------------------------------------------- |
| `CODEX_BIN`         | Path to codex binary. Default `codex`.            |
| `CLAUDE_BIN`        | Path to claude binary. Default `claude`.          |
| `OPENAI_API_KEY`    | Key for `openai` provider and codex SDK fallback. |
| `ANTHROPIC_API_KEY` | Key for `anthropic` and `claude` provider.        |
| `BROWSER_AGENT_ENV` | `local` or `cloud`. Forces transport policy.      |

## Examples

```sh
# Headed run for debugging.
browser-agent --no-headless --verbose "Open example.com and report the H1"

# Pipe a task in.
echo "Find pricing on stripe.com" | browser-agent --stdin --provider claude

# Diagnose why a provider isn't resolving.
browser-agent --probe --provider claude

# Stream JSONL events for a CI pipeline.
browser-agent --json "Summarize the homepage" --output-file result.json

# OpenAI-compatible local endpoint.
browser-agent "..." --provider openai --base-url http://localhost:1234/v1 --api-key local
```

## Exit codes

| Code | Meaning                                                                                          |
| ---- | ------------------------------------------------------------------------------------------------ |
| 0    | Run succeeded (`result.success === true`).                                                       |
| 1    | Run failed for any reason: parse error, no transport, agent gave up, schema violation, bad flag. |

## Config file format

```json
{
  "provider": "claude",
  "decisionTimeoutMs": 60000,
  "headless": true,
  "transport": "auto",
  "env": "auto"
}
```

CLI flags override file values.
