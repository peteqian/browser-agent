import type { LeaderboardRow, RunBundle, TaskRunRecord } from "./types";

export function aggregate(bundle: RunBundle): LeaderboardRow {
  const attempted = bundle.records.length;
  const passed = bundle.records.filter((r) => r.toolChoiceResult.verdict).length;

  const byCategoryAcc: Record<string, { attempted: number; passed: number; f1Sum: number }> = {};
  let pSum = 0;
  let rSum = 0;
  let fSum = 0;
  let forbidden = 0;

  for (const r of bundle.records) {
    if (!byCategoryAcc[r.category]) {
      byCategoryAcc[r.category] = { attempted: 0, passed: 0, f1Sum: 0 };
    }
    const cat = byCategoryAcc[r.category]!;
    cat.attempted += 1;
    if (r.toolChoiceResult.verdict) cat.passed += 1;
    cat.f1Sum += r.toolChoiceResult.f1;
    pSum += r.toolChoiceResult.precision;
    rSum += r.toolChoiceResult.recall;
    fSum += r.toolChoiceResult.f1;
    if (r.toolChoiceResult.forbidden_hits.length) forbidden += 1;
  }

  const byCategory: LeaderboardRow["by_category"] = {};
  for (const [cat, acc] of Object.entries(byCategoryAcc)) {
    byCategory[cat] = {
      attempted: acc.attempted,
      passed: acc.passed,
      f1: acc.attempted ? acc.f1Sum / acc.attempted : 0,
    };
  }

  return {
    agent: bundle.agent,
    agent_version: bundle.agent_version,
    model: bundle.model,
    attempted,
    passed,
    pass_rate: attempted ? passed / attempted : 0,
    precision: attempted ? pSum / attempted : 0,
    recall: attempted ? rSum / attempted : 0,
    f1: attempted ? fSum / attempted : 0,
    forbidden_violations: forbidden,
    by_category: byCategory,
  };
}

export function formatLeaderboard(rows: LeaderboardRow[]): string {
  const header =
    "| Agent | Version | Model | Attempted | Passed | Pass% | Precision | Recall | F1 | Forbidden |\n| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";
  const lines = rows.map(
    (r) =>
      `| ${r.agent} | ${r.agent_version} | ${r.model} | ${r.attempted} | ${r.passed} | ${(
        r.pass_rate * 100
      ).toFixed(1)}% | ${r.precision.toFixed(2)} | ${r.recall.toFixed(2)} | ${r.f1.toFixed(
        2,
      )} | ${r.forbidden_violations} |`,
  );
  return [header, ...lines].join("\n");
}

// Exposed for tests
export function recordsForTest(records: TaskRunRecord[]): TaskRunRecord[] {
  return records;
}
