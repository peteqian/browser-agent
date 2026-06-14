import type { RunReport } from "./report";

/**
 * PII redaction for run reports, logs, and event payloads. Job-application
 * runs carry names, emails, phones, and resume contents through the event
 * stream — scrub them before persisting a report or shipping JSONL as a CI
 * artifact.
 *
 * Two layers:
 *  - pattern-based: emails, phone numbers, common secret tokens;
 *  - value-based: exact strings you already know are sensitive (reuse the
 *    same map you pass as `sensitiveData` to the agent).
 */

export interface RedactOptions {
  /** Exact values to replace wherever they appear (resume text, names, IDs). */
  values?: string[];
  /** Redact email addresses. Default: true. */
  emails?: boolean;
  /** Redact phone numbers. Default: true. */
  phones?: boolean;
  /** Replacement token. Default: "[REDACTED]". */
  placeholder?: string;
}

interface ResolvedRedact {
  values: string[];
  emails: boolean;
  phones: boolean;
  placeholder: string;
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// International-ish phone: optional +, groups of digits with space/dash/dot/parens, 7-15 digits total.
const PHONE_RE = /(?<!\w)(\+?\d[\d\s().-]{6,}\d)(?!\w)/g;

function resolve(options: RedactOptions): ResolvedRedact {
  return {
    values: (options.values ?? [])
      .filter((v) => v.length > 0)
      .toSorted((a, b) => b.length - a.length),
    emails: options.emails ?? true,
    phones: options.phones ?? true,
    placeholder: options.placeholder ?? "[REDACTED]",
  };
}

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Redact a single string. Longest known values first to avoid partial overlaps. */
export function redactString(input: string, options: RedactOptions = {}): string {
  const cfg = resolve(options);
  let out = input;
  for (const value of cfg.values) {
    out = out.replace(new RegExp(escapeRe(value), "g"), cfg.placeholder);
  }
  if (cfg.emails) out = out.replace(EMAIL_RE, cfg.placeholder);
  if (cfg.phones) {
    out = out.replace(PHONE_RE, (match) => {
      // Require ≥7 digits so we don't nuke prices, counts, or short ids.
      const digits = match.replace(/\D/g, "");
      return digits.length >= 7 ? cfg.placeholder : match;
    });
  }
  return out;
}

/** Deep-redact any JSON-serializable value (used for events/logs). */
export function redactValue<T>(value: T, options: RedactOptions = {}): T {
  if (typeof value === "string") return redactString(value, options) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactValue(v, options)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      // Don't redact base64 screenshot blobs char-by-char (pointless + slow);
      // drop the field's identifying value is the caller's job — keep as-is.
      out[key] = redactValue(v, options);
    }
    return out as T;
  }
  return value;
}

/**
 * Redact a RunReport in place-safe fashion (returns a new object). Scrubs the
 * task string, the terminal summary, and per-action messages — the parts that
 * echo page/form content. Numeric usage/cost is untouched.
 */
export function redactReport(report: RunReport, options: RedactOptions = {}): RunReport {
  return {
    ...report,
    task: redactString(report.task, options),
    result: report.result
      ? { ...report.result, summary: redactString(report.result.summary, options) }
      : report.result,
    steps: report.steps.map((step) => ({
      ...step,
      actions: step.actions.map((a) => ({
        ...a,
        ...(a.message ? { message: redactString(a.message, options) } : {}),
      })),
    })),
  };
}
