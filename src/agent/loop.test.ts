import { afterEach, describe, expect, test } from "bun:test";

import type { BrowserSession, Page } from "../browser/session";
import type { AgentEvent, DecisionInput, StepInfo } from "./contracts";
import { SYSTEM_PROMPT } from "./prompts";
import { AgentController, buildDecisionPrompt, buildDecisionUserPrompt, runAgent } from "./loop";

function makeFakeCdpSnapshot() {
  // Two interactive button elements at indexes 0 and 1, with backendNodeIds 0 and 1.
  const strings = ["https://example.com/", "Example", "BUTTON", "block", "visible", "1"];
  return {
    documents: [
      {
        documentURL: 0,
        title: 1,
        nodes: {
          nodeName: [2, 2],
          backendNodeId: [0, 1],
          attributes: [[], []],
        },
        layout: {
          nodeIndex: [0, 1],
          bounds: [
            [0, 0, 10, 10],
            [0, 0, 10, 10],
          ],
          styles: [
            [3, 4, 5, -1, -1, -1, -1],
            [3, 4, 5, -1, -1, -1, -1],
          ],
          text: [-1, -1],
          paintOrders: [0, 1],
        },
      },
    ],
    strings,
  };
}

function createFakePage(overrides: Partial<Page> = {}): Page {
  const page = {
    targetId: "page-1",
    waitForStablePage: async () => {},
    getPendingNetworkRequests: async () => [],
    evaluate: async () => ({ readyState: "complete", pendingRequestCount: 0 }),
    sendCDP: async (method: string) => {
      if (method === "Accessibility.getFullAXTree") return { nodes: [] };
      if (method === "DOMSnapshot.captureSnapshot") return makeFakeCdpSnapshot();
      return {};
    },
    waitForTimeout: async () => {
      await new Promise(() => {});
    },
    clickByBackendNodeId: async () => ({ ok: false as const, reason: "index_stale" as const }),
    ...overrides,
  };

  return page as unknown as Page;
}

const testSessions = new Set<{ close: () => Promise<void>; closed: boolean }>();

function createFakeSession(overrides: Partial<BrowserSession> = {}): BrowserSession {
  const closeOverride = overrides.close;
  const session = {
    listPageTargetIds: async () => ["page-1"],
    ...overrides,
    close: async () => {
      tracked.closed = true;
      if (closeOverride) {
        await closeOverride.call(session);
      }
    },
  };
  const tracked = session as unknown as { close: () => Promise<void>; closed: boolean };
  tracked.closed = false;
  testSessions.add(tracked);

  return session as unknown as BrowserSession;
}

afterEach(async () => {
  for (const session of testSessions) {
    if (!session.closed) {
      await session.close();
    }
  }
  testSessions.clear();
});

describe("decision prompt builders", () => {
  const input: DecisionInput = {
    task: "Check the heading",
    step: 1,
    maxSteps: 3,
    observation: "URL: https://example.com/",
    tabs: ["page-1"],
    activeTab: "page-1",
    history: [],
  };

  test("buildDecisionPrompt keeps the legacy system prompt wrapper", () => {
    expect(buildDecisionPrompt(input)).toStartWith(SYSTEM_PROMPT);
  });

  test("buildDecisionUserPrompt omits the system prompt for SDK system messages", () => {
    const prompt = buildDecisionUserPrompt(input);
    expect(prompt).not.toContain(SYSTEM_PROMPT);
    expect(prompt).toContain("Task: Check the heading");
    expect(prompt).toContain(
      "Respond with the structured decision described in the system prompt.",
    );
  });
});

describe("runAgent action timeouts", () => {
  test("records a timed-out action and lets the model recover", async () => {
    const steps: StepInfo[] = [];
    const decisions: DecisionInput[] = [];

    const result = await runAgent({
      task: "recover from a hung wait",
      page: createFakePage(),
      maxSteps: 2,
      actionTimeoutMs: 10,
      onStep: (step) => steps.push(step),
      decide: async (input) => {
        decisions.push(input);

        if (input.step === 1) {
          return {
            actions: [{ name: "wait", params: { ms: 10_000 } }],
            done: false,
          };
        }

        expect(input.history.at(-1)?.result).toContain("Timed out while running wait");
        return {
          actions: [
            {
              name: "done",
              params: { success: true, summary: "Recovered after timeout" },
            },
          ],
          done: false,
        };
      },
    });

    expect(result).toEqual({
      success: true,
      reason: "completed",
      summary: "Recovered after timeout",
      data: null,
      steps: 2,
    });
    expect(decisions).toHaveLength(2);
    expect(steps[0]?.result.ok).toBe(false);
    expect(steps[0]?.result.message).toBe("Action wait timed out after 10ms");
    expect(steps[1]?.action.name).toBe("done");
  });

  test("invalid action timeout values fall back instead of timing out immediately", async () => {
    const result = await runAgent({
      task: "use fallback timeout",
      page: createFakePage({
        waitForTimeout: async () => {},
      }),
      maxSteps: 1,
      actionTimeoutMs: Number.NaN,
      decide: async () => ({
        actions: [
          { name: "wait", params: { ms: 1 } },
          { name: "done", params: { success: true, summary: "No immediate timeout" } },
        ],
        done: false,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBe("No immediate timeout");
  });
});

describe("runAgent browser lifecycle", () => {
  test("fails before the first decision when startUrl navigation is unhealthy", async () => {
    let decisions = 0;
    const result = await runAgent({
      task: "open a bad start url",
      page: createFakePage({
        navigateWithHealthCheck: async () => ({
          ok: false,
          status: "cdp_error",
          url: "https://missing.invalid/",
          durationMs: 5,
          warning: "Navigation failed for https://missing.invalid/: net::ERR_NAME_NOT_RESOLVED",
        }),
      }),
      startUrl: "https://missing.invalid/",
      decide: async () => {
        decisions += 1;
        return { actions: [], done: false };
      },
    });

    expect(decisions).toBe(0);
    expect(result).toEqual({
      success: false,
      reason: "failed",
      summary:
        "Start URL navigation failed: Navigation failed for https://missing.invalid/: net::ERR_NAME_NOT_RESOLVED",
      data: null,
      steps: 0,
    });
  });

  test("close_browser closes the supplied session and ends the run", async () => {
    let closed = false;
    const steps: StepInfo[] = [];

    const result = await runAgent({
      task: "close the browser",
      page: createFakePage(),
      session: createFakeSession({
        close: async () => {
          closed = true;
        },
      }),
      maxSteps: 3,
      onStep: (step) => steps.push(step),
      decide: async () => ({
        actions: [{ name: "close_browser", params: {} }],
        done: false,
      }),
    });

    expect(closed).toBe(true);
    expect(result).toEqual({
      success: true,
      reason: "completed",
      summary: "Closed browser session",
      data: null,
      steps: 1,
    });
    expect(steps).toHaveLength(1);
    expect(steps[0]?.action.name).toBe("close_browser");
  });
});

describe("runAgent decision timeouts", () => {
  test("returns a deterministic failure when decision hangs", async () => {
    const result = await runAgent({
      task: "handle hung model",
      page: createFakePage(),
      maxSteps: 1,
      decisionTimeoutMs: 10,
      decide: async () => {
        await new Promise(() => {});
        throw new Error("unreachable");
      },
    });

    expect(result).toEqual({
      success: false,
      reason: "decision_timeout",
      summary: "Model decision failed: Model decision timed out after 10ms",
      data: null,
      steps: 1,
    });
  });

  test("invalid decision timeout values fall back instead of timing out immediately", async () => {
    const result = await runAgent({
      task: "use decision fallback timeout",
      page: createFakePage(),
      maxSteps: 1,
      decisionTimeoutMs: Number.NaN,
      decide: async () => ({
        actions: [{ name: "done", params: { success: true, summary: "Decision completed" } }],
        done: false,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Decision completed");
  });
});

describe("runAgent step context timeouts", () => {
  test("returns a deterministic failure when context preparation hangs", async () => {
    let decideCalled = false;

    const result = await runAgent({
      task: "handle hung page context",
      page: createFakePage({
        evaluate: async () => {
          await new Promise(() => {});
          throw new Error("unreachable");
        },
      }),
      maxSteps: 1,
      stepTimeoutMs: 10,
      decide: async () => {
        decideCalled = true;
        return { actions: [], done: true };
      },
    });

    expect(decideCalled).toBe(false);
    expect(result).toEqual({
      success: false,
      reason: "step_timeout",
      summary: "Step context preparation timed out after 10ms",
      data: null,
      steps: 1,
    });
  });

  test("invalid step timeout values fall back instead of timing out immediately", async () => {
    const result = await runAgent({
      task: "use step fallback timeout",
      page: createFakePage(),
      maxSteps: 1,
      stepTimeoutMs: Number.NaN,
      decide: async () => ({
        actions: [{ name: "done", params: { success: true, summary: "Context completed" } }],
        done: false,
      }),
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Context completed");
  });
});

describe("runAgent consecutive failures", () => {
  test("stops after maxFailures consecutive single-action failures", async () => {
    const result = await runAgent({
      task: "stop after repeated failures",
      page: createFakePage(),
      maxSteps: 5,
      maxFailures: 2,
      decide: async () => ({
        actions: [{ name: "click", params: { index: 99 } }],
        done: false,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.summary).toBe(
      "Stopped after 2 consecutive failed steps: Index [99] is not present in the current snapshot",
    );
    expect(result.steps).toBe(2);
  });

  test("stops after maxFailures consecutive multi-action failures", async () => {
    const result = await runAgent({
      task: "stop after repeated multi-action failures",
      page: createFakePage(),
      maxSteps: 5,
      maxFailures: 2,
      finalResponseAfterFailure: false,
      decide: async () => ({
        actions: [
          { name: "click", params: { index: 99 } },
          { name: "click", params: { index: 100 } },
        ],
        done: false,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.summary).toBe(
      "Stopped after 2 consecutive failed steps: Index [100] is not present in the current snapshot",
    );
    expect(result.steps).toBe(2);
  });

  test("does not count partially-successful multi-action steps as failures", async () => {
    let calls = 0;
    const result = await runAgent({
      task: "partial success resets counter",
      page: createFakePage({
        clickByBackendNodeId: async (id: number) =>
          id === 1 ? { ok: true } : { ok: false, reason: "index_stale" },
      }),
      maxSteps: 3,
      maxFailures: 2,
      finalResponseAfterFailure: false,
      decide: async () => {
        calls += 1;
        if (calls < 3) {
          return {
            actions: [
              { name: "click", params: { index: 99 } },
              { name: "click", params: { index: 1 } },
            ],
            done: false,
          };
        }
        return {
          actions: [{ name: "done", params: { success: true, summary: "Done" } }],
          done: false,
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Done");
  });

  test("can ask for a final recovery response after maxFailures", async () => {
    let calls = 0;

    const result = await runAgent({
      task: "summarize after repeated failures",
      page: createFakePage(),
      maxSteps: 3,
      maxFailures: 2,
      finalResponseAfterFailure: true,
      decide: async (input) => {
        calls += 1;
        if (calls <= 2) {
          return {
            actions: [{ name: "click", params: { index: 99 } }],
            done: false,
          };
        }

        expect(input.observation).toContain("FINAL RECOVERY");
        expect(input.history.at(-1)?.result).toBe(
          "Index [99] is not present in the current snapshot",
        );
        return {
          actions: [
            {
              name: "done",
              params: { success: false, summary: "Could not complete after repeated failures" },
            },
          ],
          done: false,
        };
      },
    });

    expect(calls).toBe(3);
    expect(result).toEqual({
      success: false,
      reason: "failed",
      summary: "Could not complete after repeated failures",
      data: null,
      steps: 2,
    });
  });

  test("can disable final recovery after maxFailures", async () => {
    let calls = 0;

    const result = await runAgent({
      task: "stop without recovery",
      page: createFakePage(),
      maxSteps: 3,
      maxFailures: 2,
      finalResponseAfterFailure: false,
      decide: async () => {
        calls += 1;
        return {
          actions: [{ name: "click", params: { index: 99 } }],
          done: false,
        };
      },
    });

    expect(calls).toBe(2);
    expect(result.summary).toBe(
      "Stopped after 2 consecutive failed steps: Index [99] is not present in the current snapshot",
    );
  });

  test("resets consecutive failures after a successful action step", async () => {
    let call = 0;

    const result = await runAgent({
      task: "recover between failures",
      page: createFakePage({
        clickByBackendNodeId: async (id: number) =>
          id === 1 ? { ok: true } : { ok: false, reason: "index_stale" },
      }),
      maxSteps: 4,
      maxFailures: 2,
      decide: async () => {
        call += 1;
        if (call === 1 || call === 3) {
          return {
            actions: [{ name: "click", params: { index: 99 } }],
            done: false,
          };
        }
        if (call === 2) {
          return {
            actions: [{ name: "click", params: { index: 1 } }],
            done: false,
          };
        }
        return {
          actions: [{ name: "done", params: { success: true, summary: "Recovered" } }],
          done: false,
        };
      },
    });

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Recovered");
    expect(result.steps).toBe(4);
  });

  test("invalid maxFailures values fall back instead of stopping immediately", async () => {
    const result = await runAgent({
      task: "use max failure fallback",
      page: createFakePage(),
      maxSteps: 1,
      maxFailures: Number.NaN,
      decide: async () => ({
        actions: [{ name: "click", params: { index: 99 } }],
        done: false,
      }),
    });

    expect(result.success).toBe(false);
    expect(result.summary).toBe("Exceeded max steps (1).");
  });
});

describe("runAgent loop detection", () => {
  test("strict mode stops after repeated identical action fingerprints", async () => {
    const result = await runAgent({
      task: "detect repeated loop",
      page: createFakePage({
        clickByBackendNodeId: async () => ({ ok: true }),
      }),
      maxSteps: 5,
      loopDetectionMode: "strict",
      loopDetectionWindow: 3,
      decide: async () => ({
        actions: [{ name: "click", params: { index: 1 } }],
        done: false,
      }),
    });

    expect(result).toEqual({
      success: false,
      reason: "loop_detected",
      summary: "Stopped after detecting a repeated action loop over 3 steps.",
      data: null,
      steps: 3,
    });
  });

  test("default nudge mode emits notices and escalates to a hard stop after the budget is spent", async () => {
    const nudges: number[] = [];
    const result = await runAgent({
      task: "nudge then escalate",
      page: createFakePage({
        clickByBackendNodeId: async () => ({ ok: true }),
      }),
      maxSteps: 10,
      loopDetectionWindow: 3,
      loopDetectionNudgeBudget: 2,
      onEvent: async (event) => {
        if (event.type === "loop_nudge") nudges.push(event.nudgesUsed);
      },
      decide: async () => ({
        actions: [{ name: "click", params: { index: 1 } }],
        done: false,
      }),
    });

    expect(nudges).toEqual([1, 2]);
    expect(result.reason).toBe("loop_detected");
  });

  test("can disable loop detection", async () => {
    const result = await runAgent({
      task: "allow repeated loop",
      page: createFakePage({
        clickByBackendNodeId: async () => ({ ok: true }),
      }),
      maxSteps: 3,
      loopDetectionEnabled: false,
      loopDetectionWindow: 2,
      decide: async () => ({
        actions: [{ name: "click", params: { index: 1 } }],
        done: false,
      }),
    });

    expect(result).toEqual({
      success: false,
      reason: "max_steps",
      summary: "Exceeded max steps (3).",
      data: null,
      steps: 3,
    });
  });

  test("invalid loop detection window falls back", async () => {
    const result = await runAgent({
      task: "fallback loop window",
      page: createFakePage({
        clickByBackendNodeId: async () => ({ ok: true }),
      }),
      maxSteps: 4,
      loopDetectionMode: "strict",
      loopDetectionWindow: Number.NaN,
      decide: async () => ({
        actions: [{ name: "click", params: { index: 1 } }],
        done: false,
      }),
    });

    expect(result.summary).toBe("Stopped after detecting a repeated action loop over 4 steps.");
    expect(result.steps).toBe(4);
  });
});

describe("AgentController", () => {
  test("can pause and resume before the next step", async () => {
    const control = new AgentController();
    const decisions: number[] = [];
    let firstStepSeen: (() => void) | undefined;

    const firstStepPromise = new Promise<void>((resolve) => {
      firstStepSeen = resolve;
    });

    const runPromise = runAgent({
      task: "pause and resume",
      page: createFakePage({ clickByBackendNodeId: async () => ({ ok: true }) }),
      control,
      loopDetectionEnabled: false,
      maxSteps: 2,
      onStep: (step) => {
        if (step.step === 1) {
          control.pause();
          firstStepSeen?.();
        }
      },
      decide: async (input) => {
        decisions.push(input.step);
        if (input.step === 1) {
          return { actions: [{ name: "click", params: { index: 1 } }], done: false };
        }
        return {
          actions: [{ name: "done", params: { success: true, summary: "Resumed" } }],
          done: false,
        };
      },
    });

    await firstStepPromise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(decisions).toEqual([1]);

    control.resume();
    const result = await runPromise;

    expect(result.success).toBe(true);
    expect(result.summary).toBe("Resumed");
    expect(decisions).toEqual([1, 2]);
  });

  test("can stop a paused run", async () => {
    const control = new AgentController();
    control.pause();

    const runPromise = runAgent({
      task: "stop while paused",
      page: createFakePage(),
      control,
      maxSteps: 1,
      decide: async () => {
        throw new Error("decide should not be called");
      },
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    control.stop("user requested stop");

    const result = await runPromise;

    expect(result).toEqual({
      success: false,
      reason: "stopped",
      summary: "Agent run stopped: user requested stop",
      data: null,
      steps: 0,
    });
  });

  test("emits decision, action, and terminal events in order", async () => {
    const events: AgentEvent[] = [];

    await runAgent({
      task: "emit events",
      page: createFakePage({ clickByBackendNodeId: async () => ({ ok: true }) }),
      maxSteps: 1,
      decide: async () => ({
        actions: [
          { name: "click", params: { index: 1 } },
          { name: "done", params: { success: true, summary: "Done" } },
        ],
        done: false,
      }),
      onEvent: (event) => {
        events.push(event);
      },
    });

    expect(events.map((e) => e.type)).toEqual([
      "browser_state",
      "decision",
      "action_start",
      "action",
      "action_start",
      "action",
      "terminal",
    ]);
    const terminal = events[6];
    expect(terminal?.type).toBe("terminal");
    if (terminal?.type === "terminal") {
      expect(terminal.result.reason).toBe("completed");
      expect(terminal.result.success).toBe(true);
    }
  });

  test("can stop before executing the next action", async () => {
    const control = new AgentController();

    const result = await runAgent({
      task: "stop before action",
      page: createFakePage(),
      control,
      maxSteps: 1,
      decide: async () => {
        control.stop("before action");
        return { actions: [{ name: "click", params: { index: 1 } }], done: false };
      },
    });

    expect(result).toEqual({
      success: false,
      reason: "stopped",
      summary: "Agent run stopped: before action",
      data: null,
      steps: 1,
    });
  });
});

describe("runAgent final judge", () => {
  test("rejects a successful done when the judge returns pass: false", async () => {
    const result = await runAgent({
      task: "judge rejects",
      page: createFakePage({ waitForTimeout: async () => {} }),
      maxSteps: 2,
      decide: async () => ({
        actions: [{ name: "done", params: { success: true, summary: "claims done" } }],
        done: true,
      }),
      judge: async () => ({ pass: false, reason: "missing requirements" }),
    });

    expect(result.success).toBe(false);
    expect(result.reason).toBe("judge_failed");
    expect(result.summary).toContain("missing requirements");
  });

  test("confirms a successful done when the judge returns pass: true", async () => {
    const result = await runAgent({
      task: "judge accepts",
      page: createFakePage({ waitForTimeout: async () => {} }),
      maxSteps: 2,
      decide: async () => ({
        actions: [{ name: "done", params: { success: true, summary: "all good" } }],
        done: true,
      }),
      judge: async () => ({ pass: true }),
    });

    expect(result.success).toBe(true);
    expect(result.reason).toBe("completed");
  });

  test("does not run the judge when done is success=false", async () => {
    let called = 0;
    const result = await runAgent({
      task: "skip judge on failure",
      page: createFakePage({ waitForTimeout: async () => {} }),
      maxSteps: 2,
      decide: async () => ({
        actions: [{ name: "done", params: { success: false, summary: "gave up" } }],
        done: true,
      }),
      judge: async () => {
        called += 1;
        return { pass: true };
      },
    });

    expect(called).toBe(0);
    expect(result.reason).toBe("failed");
  });
});

describe("runAgent persistent memory", () => {
  test("seeds DecisionInput.memory from options and propagates Decision.memory updates", async () => {
    const seen: Array<string | undefined> = [];
    await runAgent({
      task: "carry memory",
      page: createFakePage({ waitForTimeout: async () => {} }),
      maxSteps: 3,
      memory: "seed-memory",
      decide: async (input) => {
        seen.push(input.memory);
        if (input.step === 1) {
          return {
            actions: [{ name: "wait", params: { ms: 1 } }],
            done: false,
            memory: "updated-after-step-1",
          };
        }
        return {
          actions: [{ name: "done", params: { success: true, summary: "ok" } }],
          done: true,
        };
      },
    });

    expect(seen).toEqual(["seed-memory", "updated-after-step-1"]);
  });

  test("buildDecisionUserPrompt includes the Current memory section when set", () => {
    const prompt = buildDecisionUserPrompt({
      task: "x",
      step: 1,
      maxSteps: 2,
      observation: "",
      tabs: [],
      activeTab: "",
      history: [],
      memory: "remember this",
    });
    expect(prompt).toContain("Current memory:\nremember this");
  });
});

describe("runAgent final-step finalization", () => {
  test("prepends FINAL STEP notice to observation on the last allowed step", async () => {
    const seen: string[] = [];
    await runAgent({
      task: "finalize cleanly",
      page: createFakePage({ waitForTimeout: async () => {} }),
      maxSteps: 2,
      decide: async (input) => {
        seen.push(input.observation);
        if (input.step === 1) {
          return { actions: [{ name: "wait", params: { ms: 1 } }], done: false };
        }
        return {
          actions: [{ name: "done", params: { success: true, summary: "finalized" } }],
          done: true,
        };
      },
    });

    expect(seen).toHaveLength(2);
    expect(seen[0]).not.toContain("FINAL STEP");
    expect(seen[1]).toContain("FINAL STEP (2/2)");
    expect(seen[1]).toContain("`done` action");
  });
});
