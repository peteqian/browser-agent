import type { ElementInfo } from "../../dom/types";

/**
 * Applicant identity used to pre-fill job-application forms deterministically
 * instead of paying an LLM round-trip per field. Standard fields are matched
 * by a built-in synonym map; `custom` answers cover free-form questions
 * (matched against the field label, fuzzily).
 */
export interface ApplicantProfile {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  country?: string;
  postalCode?: string;
  linkedin?: string;
  github?: string;
  website?: string;
  /** Absolute path to a resume/CV file, for `upload_file`. */
  resumePath?: string;
  /** Years of experience, salary expectation, etc. */
  custom?: Record<string, string>;
}

export type AutofillFieldKind = "text" | "select" | "file";

export interface AutofillSuggestion {
  index: number;
  value: string;
  kind: AutofillFieldKind;
  /** Which profile field or question matched this element. */
  matchedField: string;
  /** Why it matched — for trace/debug output. */
  matchedBy: string;
}

/** Profile keys → label/name substrings that identify the field. */
const FIELD_SYNONYMS: Array<{ field: keyof ApplicantProfile; needles: string[] }> = [
  {
    field: "firstName",
    needles: ["first name", "given name", "forename", "first_name", "firstname"],
  },
  { field: "lastName", needles: ["last name", "surname", "family name", "last_name", "lastname"] },
  { field: "fullName", needles: ["full name", "your name", "name"] },
  { field: "email", needles: ["email", "e-mail"] },
  { field: "phone", needles: ["phone", "mobile", "telephone", "cell"] },
  { field: "address", needles: ["street", "address line", "address"] },
  { field: "city", needles: ["city", "town"] },
  { field: "state", needles: ["state", "province", "region"] },
  { field: "country", needles: ["country"] },
  { field: "postalCode", needles: ["zip", "postal", "postcode"] },
  { field: "linkedin", needles: ["linkedin"] },
  { field: "github", needles: ["github"] },
  { field: "website", needles: ["website", "portfolio", "personal site", "url"] },
];

function norm(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function fieldLabel(el: ElementInfo): string {
  return norm(
    el.labelText ?? el.axName ?? el.ariaLabel ?? el.placeholder ?? el.name ?? el.testId ?? "",
  );
}

function isTextField(el: ElementInfo): boolean {
  if (el.tag === "textarea") return true;
  if (el.tag === "input") {
    const t = norm(el.type);
    return t === "" || ["text", "email", "tel", "url", "search"].includes(t);
  }
  const role = norm(el.axRole ?? el.role);
  return role === "textbox" || role === "searchbox" || role === "combobox";
}

function isFileField(el: ElementInfo): boolean {
  return el.tag === "input" && norm(el.type) === "file";
}

function isSelectField(el: ElementInfo): boolean {
  return el.tag === "select" || norm(el.axRole ?? el.role) === "listbox";
}

/**
 * Plan deterministic fills for the form elements in a snapshot. The first
 * unfilled element matching each profile field wins; full-name falls back to
 * `${firstName} ${lastName}`. Custom Q&A is matched last so it can't shadow a
 * standard field. Returns nothing for fields with no value or no match —
 * those stay for the model to handle.
 */
export function planAutofill(
  profile: ApplicantProfile,
  elements: readonly ElementInfo[],
  answers?: AnswerBank,
): AutofillSuggestion[] {
  const suggestions: AutofillSuggestion[] = [];
  const usedIndexes = new Set<number>();
  const visible = elements.filter((el) => el.bbox.w > 0 && el.bbox.h > 0);

  const resolved: Record<string, string | undefined> = {
    firstName: profile.firstName,
    lastName: profile.lastName,
    fullName: profile.fullName,
    email: profile.email,
    phone: profile.phone,
    address: profile.address,
    city: profile.city,
    state: profile.state,
    country: profile.country,
    postalCode: profile.postalCode,
    linkedin: profile.linkedin,
    github: profile.github,
    website: profile.website,
  };
  if (!resolved.fullName && (profile.firstName || profile.lastName)) {
    resolved.fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ").trim();
  }

  // Standard fields, in synonym priority order; "name" (fullName) is matched
  // only after first/last so it doesn't grab a first-name input.
  for (const { field, needles } of FIELD_SYNONYMS) {
    const value = resolved[field as string];
    if (!value) continue;
    const fileWanted = field === "resumePath";
    for (const el of visible) {
      if (usedIndexes.has(el.index)) continue;
      const label = fieldLabel(el);
      if (!needles.some((n) => label.includes(n))) continue;
      if (fileWanted ? !isFileField(el) : !(isTextField(el) || isSelectField(el))) continue;
      usedIndexes.add(el.index);
      suggestions.push({
        index: el.index,
        value,
        kind: isFileField(el) ? "file" : isSelectField(el) ? "select" : "text",
        matchedField: field as string,
        matchedBy: `label~"${label}"`,
      });
      break;
    }
  }

  // Resume upload (separate from text synonyms — needs a file input).
  if (profile.resumePath) {
    const fileEl = visible.find(
      (el) =>
        !usedIndexes.has(el.index) &&
        isFileField(el) &&
        /resume|cv|attach/.test(fieldLabel(el) + " " + norm(el.name)),
    );
    if (fileEl) {
      usedIndexes.add(fileEl.index);
      suggestions.push({
        index: fileEl.index,
        value: profile.resumePath,
        kind: "file",
        matchedField: "resumePath",
        matchedBy: "file input",
      });
    }
  }

  // Custom Q&A and cached answers, matched against the field label.
  const qa: Record<string, string> = { ...profile.custom, ...answers?.entries() };
  for (const [question, value] of Object.entries(qa)) {
    if (!value) continue;
    const needle = norm(question);
    if (!needle) continue;
    const el = visible.find(
      (e) =>
        !usedIndexes.has(e.index) &&
        (isTextField(e) || isSelectField(e)) &&
        fieldLabel(e).includes(needle),
    );
    if (!el) continue;
    usedIndexes.add(el.index);
    suggestions.push({
      index: el.index,
      value,
      kind: isSelectField(el) ? "select" : "text",
      matchedField: `custom:${question}`,
      matchedBy: `label~"${needle}"`,
    });
  }

  return suggestions;
}

/**
 * Cache of answers to free-form application questions, keyed by normalized
 * question text. Lets repeated applications reuse "Why do you want to work
 * here?" style answers instead of regenerating them. Serialize via
 * `toJSON()` / `AnswerBank.fromJSON()` to persist across runs.
 */
export class AnswerBank {
  private readonly map = new Map<string, string>();

  constructor(seed?: Record<string, string>) {
    if (seed) for (const [q, a] of Object.entries(seed)) this.set(q, a);
  }

  private static key(question: string): string {
    return question.trim().toLowerCase().replace(/\s+/g, " ");
  }

  get(question: string): string | undefined {
    return this.map.get(AnswerBank.key(question));
  }

  set(question: string, answer: string): void {
    this.map.set(AnswerBank.key(question), answer);
  }

  has(question: string): boolean {
    return this.map.has(AnswerBank.key(question));
  }

  entries(): Record<string, string> {
    return Object.fromEntries(this.map);
  }

  toJSON(): Record<string, string> {
    return this.entries();
  }

  static fromJSON(data: Record<string, string>): AnswerBank {
    return new AnswerBank(data);
  }
}

/**
 * Turn autofill suggestions into agent action objects ready for the runner.
 * Text → `type` (replace), select → `select_option`, file → `upload_file`.
 */
export function autofillActions(
  suggestions: readonly AutofillSuggestion[],
): Array<{ name: string; params: Record<string, unknown> }> {
  return suggestions.map((s) => {
    if (s.kind === "file") {
      return { name: "upload_file", params: { index: s.index, paths: [s.value] } };
    }
    if (s.kind === "select") {
      return { name: "select_option", params: { index: s.index, value: s.value } };
    }
    return { name: "type", params: { index: s.index, text: s.value, mode: "replace" } };
  });
}
