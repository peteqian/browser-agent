# mcp-tool-choice leaderboard

Tool-selection accuracy across categories. Verdict requires both the
heuristic scorer (recall=1, no forbidden hits, no unknown tools, within
min/max bounds) and the LLM judge to agree.

| Agent                                         | Version | Model             | Attempted | Passed | Pass% | Precision | Recall |  F1 | Forbidden |
| --------------------------------------------- | ------- | ----------------- | --------: | -----: | ----: | --------: | -----: | --: | --------: |
| @peteqian/browser-agent-evals-mcp-tool-choice | 0.0.0   | claude-sonnet-4-5 |        13 |      — |    —% |         — |      — |   — |         — |

Run `bun --cwd evals/mcp-tool-choice run start` to populate.
