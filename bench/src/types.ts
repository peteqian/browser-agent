export interface BenchTask {
  task_id: string;
  category: "custom" | "qa" | "multi-step" | "form" | "stealth";
  confirmed_task: string;
  answer?: string;
  max_steps?: number;
}

export interface JudgementResult {
  reasoning: string;
  verdict: boolean;
  failure_reason: string | null;
  impossible_task: boolean;
  reached_captcha: boolean;
}

export interface TaskRunRecord {
  task_id: string;
  category: BenchTask["category"];
  agent: string;
  agent_version: string;
  model: string;
  judge_model: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  steps: number;
  reason: string;
  summary: string;
  trajectory?: string;
  judgement: JudgementResult;
  error?: string;
}

export interface RunBundle {
  commit_sha: string;
  run_started_at: string;
  agent: string;
  agent_version: string;
  model: string;
  judge_model: string;
  records: TaskRunRecord[];
}

export interface LeaderboardRow {
  agent: string;
  agent_version: string;
  model: string;
  attempted: number;
  passed: number;
  pass_rate: number;
  by_category: Record<string, { attempted: number; passed: number }>;
  avg_duration_ms: number;
  avg_steps: number;
}
