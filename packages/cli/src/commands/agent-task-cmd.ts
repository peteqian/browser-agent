import { writeFileSync } from "node:fs";

import {
  createDecide,
  redactReport,
  resolveTransport,
  runTask,
  RunReportCollector,
  TraceRecorder,
  type AgentEvent,
  type StepInfo,
} from "@peteqian/browser-agent-sdk";

import { buildOptions } from "./agent-task-options";
import { SummaryCollector, renderSummary } from "./summary";
import { resolveBrowserPaths } from "../profiles";

function writeVerbose(event: string, data: unknown): void {
  console.error(JSON.stringify({ t: new Date().toISOString(), event, data }));
}

function writeJsonl(event: AgentEvent): void {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

export async function runTaskCommand(argv: string[]): Promise<number> {
  const opts = await buildOptions(argv);

  if (opts.probe) {
    const probeResult = resolveTransport({
      provider: opts.provider,
      model: opts.model ?? "probe-only",
      apiKey: opts.apiKey,
      baseURL: opts.baseUrl,
      effort: opts.effort,
      env: opts.env,
      transport: opts.transport,
    });
    console.log(JSON.stringify(probeResult.resolution, null, 2));
    return 0;
  }

  const { decide, resolution } = createDecide({
    provider: opts.provider,
    model: opts.model,
    apiKey: opts.apiKey,
    baseURL: opts.baseUrl,
    effort: opts.effort,
    env: opts.env,
    transport: opts.transport,
    decisionMode: opts.decisionMode,
    onCodexRaw: opts.verbose ? (raw, step) => writeVerbose("model.raw", { step, raw }) : undefined,
  });

  const jsonlOnEvent = opts.json ? writeJsonl : undefined;
  const verboseOnEvent = opts.verbose
    ? (event: AgentEvent) => writeVerbose(`event.${event.type}`, event)
    : undefined;
  const summaryCollector = opts.summary ? new SummaryCollector() : undefined;
  const summaryOnEvent: ((event: AgentEvent) => void) | undefined = summaryCollector
    ? (event) => summaryCollector.observe(event)
    : undefined;
  const reportCollector = opts.reportJson ? new RunReportCollector({ task: opts.task }) : undefined;
  const traceRecorder = opts.traceDir ? new TraceRecorder({ dir: opts.traceDir }) : undefined;
  const handlers = [
    jsonlOnEvent,
    verboseOnEvent,
    summaryOnEvent,
    reportCollector?.onEvent,
    traceRecorder?.onEvent,
  ].filter((h): h is (event: AgentEvent) => void => Boolean(h));
  const onEvent: ((event: AgentEvent) => void) | undefined =
    handlers.length === 0
      ? undefined
      : handlers.length === 1
        ? handlers[0]
        : (event) => {
            for (const h of handlers) h(event);
          };

  const abortController = new AbortController();
  let signalCount = 0;
  const onSignal = (signal: string): void => {
    signalCount += 1;
    if (signalCount === 1) {
      console.error(
        `\nbrowser-agent: ${signal} received, finishing current step and closing browser...`,
      );
      abortController.abort(signal);
    } else {
      console.error(`browser-agent: ${signal} again, force exit.`);
      process.exit(130);
    }
  };
  const handleInt = (): void => onSignal("SIGINT");
  const handleTerm = (): void => onSignal("SIGTERM");
  process.on("SIGINT", handleInt);
  process.on("SIGTERM", handleTerm);

  const browserPaths = resolveBrowserPaths({
    profile: opts.profile,
    storageStatePath: opts.storageStatePath,
  });
  const agentOptions = {
    task: opts.task,
    startUrl: opts.url,
    decisionTimeoutMs: opts.decisionTimeoutMs,
    stepTimeoutMs: opts.stepTimeoutMs,
    actionTimeoutMs: opts.actionTimeoutMs,
    maxFailures: opts.maxFailures,
    cdpUrl: opts.cdpUrl,
    ...(opts.rateLimitMs || opts.rateLimitHostMs
      ? {
          rateLimit: {
            ...(opts.rateLimitMs ? { perActionMs: opts.rateLimitMs } : {}),
            ...(opts.rateLimitHostMs ? { perHostMs: opts.rateLimitHostMs } : {}),
          },
        }
      : {}),
    launch: {
      headless: opts.headless,
      autoConsent: opts.autoConsent,
      fingerprintMode: opts.fingerprintMode,
      userDataDir: browserPaths.userDataDir,
      storageStatePath: browserPaths.storageStatePath,
      initScripts: opts.initScripts,
      ...(opts.proxy ? { proxyServer: opts.proxy } : {}),
      ...(opts.proxyBypass ? { proxyBypass: opts.proxyBypass } : {}),
      ...(opts.engine === "lightpanda" ? { channel: "lightpanda" as const } : {}),
    },
    getNextAction: decide,
    transportResolution: resolution,
    vision: "auto" as const,
    fullSnapshots: opts.fullSnapshots,
    allowedDomains: opts.allowedDomains,
    signal: abortController.signal,
    onEvent,
    onStep: (step: StepInfo) => {
      if (opts.verbose) {
        writeVerbose("agent.step", step);
      }
      if (!opts.json) {
        const short = step.action.name === "done" ? "" : ` -> ${step.result.message}`;
        console.error(
          `[${step.step}] ${step.action.name}(${JSON.stringify(step.action.params)})${short}`,
        );
      }
    },
  };

  let result;
  try {
    result = await runTask(agentOptions);
  } finally {
    process.off("SIGINT", handleInt);
    process.off("SIGTERM", handleTerm);
  }

  const resultJson = JSON.stringify(result, null, 2);
  if (opts.outputFile) {
    writeFileSync(opts.outputFile, resultJson);
  }
  if (reportCollector && opts.reportJson) {
    const report = reportCollector.build();
    const finalReport = opts.redact
      ? redactReport(report, { values: opts.task ? [opts.task] : [] })
      : report;
    writeFileSync(opts.reportJson, JSON.stringify(finalReport, null, 2));
  }
  if (traceRecorder) {
    traceRecorder.finalize();
  }
  if (!opts.json) {
    console.log(resultJson);
  }
  if (summaryCollector) {
    console.log(renderSummary(summaryCollector.snapshot()));
  }
  return result.success ? 0 : 1;
}
