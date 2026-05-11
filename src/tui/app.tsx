import React, { useEffect, useMemo, useState } from "react";
import { Box, render, Text, useInput } from "ink";

import { AgentController, runAgent } from "../agent/loop";
import type {
  AgentAction,
  AgentControl,
  AgentEvent,
  AgentOptions,
  AgentResult,
  PlanItem,
} from "../agent/contracts";

interface TuiState {
  status: "starting" | "running" | "paused" | "stopped" | "done";
  step: number;
  url: string;
  title: string;
  plan: PlanItem[];
  memory: string;
  nextGoal: string;
  thought: string;
  screenshot: string;
  logs: string[];
  result: AgentResult | null;
  currentAction: AgentAction | null;
}

const initialState: TuiState = {
  status: "starting",
  step: 0,
  url: "",
  title: "",
  plan: [],
  memory: "",
  nextGoal: "",
  thought: "",
  screenshot: "",
  logs: [],
  result: null,
  currentAction: null,
};

export async function runTui<TData>(options: AgentOptions<TData>): Promise<AgentResult<TData>> {
  const control = options.control ?? new AgentController();
  let resolveResult!: (result: AgentResult<TData>) => void;
  let rejectResult!: (error: unknown) => void;
  const resultPromise = new Promise<AgentResult<TData>>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const app = render(
    <BrowserAgentTui
      options={{ ...options, control } as AgentOptions}
      control={control}
      onDone={(result) => resolveResult(result as AgentResult<TData>)}
      onError={rejectResult}
    />,
  );

  try {
    return await resultPromise;
  } finally {
    app.unmount();
  }
}

function BrowserAgentTui({
  options,
  control,
  onDone,
  onError,
}: {
  options: AgentOptions;
  control: AgentControl;
  onDone: (result: AgentResult) => void;
  onError: (error: unknown) => void;
}) {
  const [state, setState] = useState<TuiState>(initialState);
  const [logOffset, setLogOffset] = useState(0);

  useEffect(() => {
    let active = true;

    void runAgent({
      ...options,
      onEvent: async (event) => {
        await options.onEvent?.(event);
        if (!active) return;
        setState((current) => reduceEvent(current, event));
      },
    })
      .then((result) => {
        if (!active) return;
        setState((current: TuiState) => ({ ...current, status: "done", result }));
        onDone(result);
      })
      .catch((error) => {
        if (!active) return;
        onError(error);
      });

    return () => {
      active = false;
    };
  }, []);

  useInput((input, key) => {
    if (input === "q" || key.escape) {
      control.stop("user requested stop from TUI");
      setState((current: TuiState) => ({ ...current, status: "stopped" }));
      return;
    }
    if (input === "p") {
      if (control.isPaused) {
        control.resume();
        setState((current: TuiState) => ({ ...current, status: "running" }));
      } else {
        control.pause();
        setState((current: TuiState) => ({ ...current, status: "paused" }));
      }
      return;
    }
    if (key.upArrow) setLogOffset((value: number) => Math.min(value + 1, 200));
    if (key.downArrow) setLogOffset((value: number) => Math.max(value - 1, 0));
  });

  const visibleLogs = useMemo(() => {
    const end = Math.max(0, state.logs.length - logOffset);
    return state.logs.slice(Math.max(0, end - 10), end);
  }, [state.logs, logOffset]);

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box justifyContent="space-between">
        <Text bold color="cyan">
          browser-agent
        </Text>
        <Text color={state.status === "done" ? "green" : state.status === "paused" ? "yellow" : "white"}>
          {state.status} step {state.step}
        </Text>
      </Box>
      <Text dimColor>{options.task}</Text>
      <Text>
        URL: <Text color="blue">{state.url || "(blank)"}</Text>
      </Text>
      <Text>Title: {state.title || "(none)"}</Text>
      <Text>Screenshot: {state.screenshot || "not captured"}</Text>
      <Text>Goal: {state.nextGoal || "(none)"}</Text>
      <Text>Memory: {state.memory || "(none)"}</Text>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Plan</Text>
        {state.plan.length === 0 ? (
          <Text dimColor>(none)</Text>
        ) : (
          state.plan.slice(0, 6).map((item) => (
            <Text key={item.id}>
              {marker(item.status)} {item.text}
            </Text>
          ))
        )}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text bold>Log</Text>
        {visibleLogs.map((line, index) => (
          <Text key={`${index}-${line}`}>{line}</Text>
        ))}
      </Box>

      <Text dimColor>p pause/resume  q quit  arrows scroll log</Text>
    </Box>
  );
}

function reduceEvent(state: TuiState, event: AgentEvent): TuiState {
  if (event.type === "browser_state") {
    return {
      ...state,
      status: state.status === "paused" ? "paused" : "running",
      step: event.step,
      url: event.state.url,
      title: event.state.title,
    };
  }
  if (event.type === "screenshot") {
    return {
      ...state,
      screenshot: `${event.screenshot.width}x${event.screenshot.height} ${event.screenshot.mediaType}`,
    };
  }
  if (event.type === "planning") {
    return {
      ...state,
      plan: event.plan ?? state.plan,
      memory: event.memory ?? state.memory,
      nextGoal: event.nextGoal ?? state.nextGoal,
    };
  }
  if (event.type === "decision") {
    return {
      ...state,
      thought: event.decision.thought ?? "",
      logs: appendLog(state.logs, `[${event.step}] decision ${event.decision.actions[0]?.name ?? "none"}`),
    };
  }
  if (event.type === "action_start") {
    return {
      ...state,
      currentAction: event.action,
      logs: appendLog(state.logs, `[${event.step}] start ${event.action.name}`),
    };
  }
  if (event.type === "action") {
    return {
      ...state,
      currentAction: null,
      logs: appendLog(
        state.logs,
        `[${event.step}] ${event.action.name} ${event.result.ok ? "ok" : "failed"}: ${event.result.message}`,
      ),
    };
  }
  if (event.type === "terminal") {
    return {
      ...state,
      status: "done",
      result: event.result,
      logs: appendLog(state.logs, `terminal ${event.result.reason}: ${event.result.summary}`),
    };
  }
  return state;
}

function appendLog(logs: string[], line: string): string[] {
  return [...logs, line].slice(-200);
}

function marker(status: PlanItem["status"]): string {
  if (status === "done") return "x";
  if (status === "in_progress") return ">";
  if (status === "blocked") return "!";
  return "-";
}
