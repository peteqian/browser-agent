import type { LeaderboardRow, RunBundle } from "./types";

export function aggregate(bundle: RunBundle): LeaderboardRow {
  const attempted = bundle.records.length;
  const passed = bundle.records.filter((r) => r.judgement.verdict).length;
  const byCategory: LeaderboardRow["by_category"] = {};
  let totalDuration = 0;
  let totalSteps = 0;

  for (const r of bundle.records) {
    if (!byCategory[r.category]) byCategory[r.category] = { attempted: 0, passed: 0 };
    byCategory[r.category]!.attempted += 1;
    if (r.judgement.verdict) byCategory[r.category]!.passed += 1;
    totalDuration += r.duration_ms;
    totalSteps += r.steps;
  }

  return {
    agent: bundle.agent,
    agent_version: bundle.agent_version,
    model: bundle.model,
    attempted,
    passed,
    pass_rate: attempted ? passed / attempted : 0,
    by_category: byCategory,
    avg_duration_ms: attempted ? Math.round(totalDuration / attempted) : 0,
    avg_steps: attempted ? Math.round(totalSteps / attempted) : 0,
  };
}

export function formatLeaderboard(rows: LeaderboardRow[]): string {
  const header =
    "| Agent | Version | Model | Attempted | Passed | Pass% | Avg steps | Avg duration |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |";
  const lines = rows.map(
    (r) =>
      `| ${r.agent} | ${r.agent_version} | ${r.model} | ${r.attempted} | ${r.passed} | ${(r.pass_rate * 100).toFixed(1)}% | ${r.avg_steps} | ${(r.avg_duration_ms / 1000).toFixed(1)}s |`,
  );
  return [header, ...lines].join("\n");
}
