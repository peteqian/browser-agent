import { describe, expect, test } from "bun:test";

import type { AgentEvent } from "./contracts";
import { TraceRecorder, renderTimelineHtml } from "./trace";

function fakeFs() {
  const files = new Map<string, string | Buffer>();
  const dirs: string[] = [];
  return {
    files,
    dirs,
    impl: {
      mkdirSync: (path: string) => {
        dirs.push(path);
      },
      writeFileSync: (path: string, data: string | Buffer) => {
        files.set(path, data);
      },
    },
  };
}

function runEvents(): AgentEvent<unknown>[] {
  return [
    {
      type: "browser_state",
      step: 1,
      state: {
        url: "https://jobs.example.com/apply",
        title: "Apply",
        activeTab: "t1",
        tabs: [],
        viewport: { width: 1280, height: 900 },
        readyState: "complete",
        pendingRequests: [],
        elements: [],
        selectorMap: { byIndex: new Map() },
        observation: '@e0 [textbox] "First Name"',
        snapshot: {
          url: "",
          title: "",
          elements: [],
          stability: { readyState: "complete", pendingRequestCount: 0 },
        },
        observationIsDiff: false,
      },
    },
    {
      type: "screenshot",
      step: 1,
      screenshot: {
        base64: Buffer.from("PNGDATA").toString("base64"),
        mediaType: "image/png",
        width: 1280,
        height: 900,
        capturedAt: "2026-06-12T00:00:00Z",
        detail: "auto",
      },
    },
    {
      type: "decision",
      step: 1,
      decision: {
        thought: "Fill the first name field.",
        actions: [{ name: "type", params: { index: 0, text: "Ada" } }],
        done: false,
      },
    },
    {
      type: "action",
      step: 1,
      url: "https://jobs.example.com/apply",
      action: { name: "type", params: { index: 0, text: "Ada" } },
      result: { ok: true, message: "Typed into [0]" },
    },
    {
      type: "terminal",
      result: { success: true, reason: "completed", summary: "Applied", data: null, steps: 1 },
    },
  ];
}

describe("TraceRecorder", () => {
  test("records steps, screenshot file, and writes bundle on finalize", () => {
    const fs = fakeFs();
    const tracer = new TraceRecorder({ dir: "/traces/run", fs: fs.impl });
    for (const event of runEvents()) tracer.handleEvent(event);
    tracer.finalize();

    const manifest = tracer.manifest();
    expect(manifest.result?.success).toBe(true);
    expect(manifest.steps).toHaveLength(1);
    expect(manifest.steps[0]).toMatchObject({
      step: 1,
      url: "https://jobs.example.com/apply",
      thought: "Fill the first name field.",
      screenshotFile: "step-1.png",
    });
    expect(manifest.steps[0]!.actions[0]).toMatchObject({
      name: "type",
      ok: true,
      message: "Typed into [0]",
    });

    // screenshot, trace.json, index.html written
    expect(fs.files.has("/traces/run/step-1.png")).toBe(true);
    expect(fs.files.has("/traces/run/trace.json")).toBe(true);
    const html = fs.files.get("/traces/run/index.html") as string;
    expect(html).toContain("browser-agent trace");
    expect(html).toContain("step-1.png");
    expect(html).toContain("completed");
  });

  test("screenshots:false skips image persistence", () => {
    const fs = fakeFs();
    const tracer = new TraceRecorder({ dir: "/traces/run", fs: fs.impl, screenshots: false });
    for (const event of runEvents()) tracer.handleEvent(event);
    expect(tracer.manifest().steps[0]?.screenshotFile).toBeUndefined();
    expect(fs.files.has("/traces/run/step-1.png")).toBe(false);
  });
});

describe("renderTimelineHtml", () => {
  test("escapes content and marks failed actions", () => {
    const html = renderTimelineHtml({
      startedAt: "2026-06-12T00:00:00Z",
      result: { success: false, reason: "max_failures", summary: "broke <b>" },
      steps: [
        {
          step: 1,
          url: "https://x.test",
          actions: [{ name: "click", ok: false, message: "stale & gone" }],
        },
      ],
    });
    expect(html).toContain("broke &lt;b&gt;");
    expect(html).toContain("stale &amp; gone");
    expect(html).toContain('class="fail"');
    expect(html).toContain("❌");
  });
});
