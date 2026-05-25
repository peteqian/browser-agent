export type ToolChoiceCategory =
  | "auth"
  | "navigation"
  | "extraction"
  | "interaction"
  | "session"
  | "multi-step"
  | "negative";

export interface BenchTask {
  task_id: string;
  category: ToolChoiceCategory;
  confirmed_task: string;
  expected_tools: string[];
  forbidden_tools?: string[];
  min_calls?: number;
  max_calls?: number;
}

export interface ToolChoiceResult {
  called: string[];
  precision: number;
  recall: number;
  f1: number;
  forbidden_hits: string[];
  verdict: boolean;
  reasoning: string;
}

export interface PlanResult {
  plan: string[];
  raw: string;
  error?: string;
}

export interface TaskRunRecord {
  task_id: string;
  category: ToolChoiceCategory;
  agent: string;
  agent_version: string;
  model: string;
  judge_model: string;
  started_at: string;
  ended_at: string;
  duration_ms: number;
  expected_tools: string[];
  forbidden_tools: string[];
  toolChoiceResult: ToolChoiceResult;
  rawPlan: string;
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
  precision: number;
  recall: number;
  f1: number;
  forbidden_violations: number;
  by_category: Record<string, { attempted: number; passed: number; f1: number }>;
}
