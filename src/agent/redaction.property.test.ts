import { describe, expect, test } from "bun:test";

import type { BrowserSession, Page } from "../browser/session";
import type { AgentEvent, AgentInput, StepInfo } from "./contracts";
import { runAgent } from "./loop";

/**
 * Property-style redaction test: across many randomized secret values, prove
 * that `<secret>KEY</secret>` substitution never leaks the real value into:
 *  - StepInfo seen by `onStep`
 *  - AgentEvent stream seen by `onEvent`
 *  - AgentInput.history surfaced to the model on the next step
 *  - the final AgentResult
 *
 * The fake `typeByBackendNodeId` records the value it actually receives so we
 * can simultaneously assert the substituted value DID make it to the page.
 */

function makeFakeCdpSnapshot() {
  const strings = ["https://example.com/", "Example", "INPUT", "block", "visible", "1"];
  return {
    documents: [
      {
        documentURL: 0,
        title: 1,
        nodes: {
          nodeName: [2],
          backendNodeId: [0],
          attributes: [[]],
        },
        layout: {
          nodeIndex: [0],
          bounds: [[0, 0, 100, 30]],
          styles: [[3, 4, 5, -1, -1, -1, -1]],
          text: [-1],
          paintOrders: [0],
        },
      },
    ],
    strings,
  };
}

function createFakePage(received: { text?: string }): Page {
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
    waitForTimeout: async () => {},
    typeByBackendNodeId: async (
      _backendNodeId: number,
      text: string,
      _submit?: boolean,
      _mode?: "replace" | "append",
    ) => {
      received.text = text;
      return { ok: true as const };
    },
  };
  return page as unknown as Page;
}

function createFakeSession(): BrowserSession {
  return {
    listPageTargetIds: async () => ["page-1"],
    close: async () => {},
  } as unknown as BrowserSession;
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*";

function randomSecret(rand: () => number, minLen: number, maxLen: number): string {
  const len = minLen + Math.floor(rand() * (maxLen - minLen + 1));
  let out = "";
  for (let i = 0; i < len; i += 1) {
    out += ALPHABET[Math.floor(rand() * ALPHABET.length)];
  }
  return out;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("redaction property: sensitive values never leak past the action executor", () => {
  const ITERATIONS = 30;

  for (let i = 0; i < ITERATIONS; i += 1) {
    const rand = mulberry32(0xc0ffee + i);
    const key = randomSecret(rand, 4, 12).replace(/[^a-zA-Z0-9_.-]/g, "k");
    // Real value MUST not contain the literal placeholder, otherwise the
    // "value never appears" assertion would be trivially violated by the
    // placeholder itself. The alphabet contains no `<` so this is safe.
    const value = randomSecret(rand, 6, 24);

    test(`iteration ${i}: key=${key}`, async () => {
      const received: { text?: string } = {};
      const steps: StepInfo[] = [];
      const events: AgentEvent[] = [];
      const decisions: AgentInput[] = [];

      const result = await runAgent({
        task: `log in with <secret>${key}</secret>`,
        page: createFakePage(received),
        session: createFakeSession(),
        maxSteps: 3,
        sensitiveData: { [key]: value },
        onStep: (step) => {
          steps.push(step);
        },
        onEvent: (event) => {
          events.push(event);
        },
        decide: async (input) => {
          decisions.push(input);
          if (input.step === 1) {
            return {
              actions: [
                {
                  name: "type",
                  params: {
                    index: 0,
                    text: `<secret>${key}</secret>`,
                    mode: "replace",
                  },
                },
              ],
              done: false,
            };
          }
          return {
            actions: [
              {
                name: "done",
                params: { success: true, summary: "submitted" },
              },
            ],
            done: false,
          };
        },
      });

      // 1. The real value reached the page (substitution did fire).
      expect(received.text).toBe(value);

      // 2. The real value never reached anything the caller observes.
      const serializedSteps = JSON.stringify(steps);
      const serializedEvents = JSON.stringify(events);
      const serializedDecisions = JSON.stringify(decisions);
      const serializedResult = JSON.stringify(result);

      expect(serializedSteps).not.toContain(value);
      expect(serializedEvents).not.toContain(value);
      expect(serializedDecisions).not.toContain(value);
      expect(serializedResult).not.toContain(value);

      // 3. The placeholder is preserved everywhere the value was redacted —
      //    proves we didn't dodge the previous check by simply dropping the
      //    field.
      const placeholder = `<secret>${key}</secret>`;
      expect(serializedSteps).toContain(placeholder);
      expect(serializedEvents).toContain(placeholder);
      // Step-2 AgentInput.history records the prior action with placeholder
      // intact.
      expect(serializedDecisions).toContain(placeholder);
    });
  }
});
