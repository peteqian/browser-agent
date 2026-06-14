import { describe, expect, test } from "bun:test";

import type { ElementInfo } from "../dom/types";
import { AnswerBank, autofillActions, planAutofill } from "./autofill";

let seq = 0;
function field(
  init: Partial<ElementInfo> & { label: string; tag?: string; type?: string },
): ElementInfo {
  const index = seq++;
  return {
    index,
    backendNodeId: 100 + index,
    framePath: "main",
    tag: init.tag ?? "input",
    role: null,
    text: "",
    href: null,
    name: init.name ?? null,
    ariaName: null,
    type: init.type ?? "text",
    placeholder: null,
    value: null,
    ariaLabel: null,
    selectorHint: "",
    bbox: { x: 0, y: index * 30, w: 200, h: 24 },
    axRole: init.axRole ?? "textbox",
    axName: init.label,
    testId: null,
    dataAttrs: {},
    labelText: init.label,
    stableHandle: { kind: "label", value: init.label },
    stableId: `id-${index}`,
    ...init,
  } as ElementInfo;
}

describe("planAutofill", () => {
  test("matches standard fields by label synonyms", () => {
    seq = 0;
    const elements = [
      field({ label: "First Name" }),
      field({ label: "Last Name" }),
      field({ label: "Email Address", type: "email" }),
      field({ label: "Phone", type: "tel" }),
    ];
    const out = planAutofill(
      { firstName: "Ada", lastName: "Lovelace", email: "ada@x.com", phone: "555-1" },
      elements,
    );
    expect(out.map((s) => [s.matchedField, s.value])).toEqual([
      ["firstName", "Ada"],
      ["lastName", "Lovelace"],
      ["email", "ada@x.com"],
      ["phone", "555-1"],
    ]);
  });

  test("first/last name do not get shadowed by a generic name field", () => {
    seq = 0;
    const elements = [field({ label: "First Name" }), field({ label: "Last Name" })];
    const out = planAutofill(
      { firstName: "Ada", lastName: "Lovelace", fullName: "Ada Lovelace" },
      elements,
    );
    // fullName has no dedicated field here; first/last fill, fullName is dropped
    expect(out.map((s) => s.matchedField).toSorted()).toEqual(["firstName", "lastName"]);
  });

  test("derives fullName from first + last when only a single name field exists", () => {
    seq = 0;
    const elements = [field({ label: "Your Name" })];
    const out = planAutofill({ firstName: "Ada", lastName: "Lovelace" }, elements);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ matchedField: "fullName", value: "Ada Lovelace" });
  });

  test("maps resume to a file input", () => {
    seq = 0;
    const elements = [field({ label: "Resume / CV", tag: "input", type: "file", axRole: null })];
    const out = planAutofill({ resumePath: "/tmp/cv.pdf" }, elements);
    expect(out[0]).toMatchObject({
      kind: "file",
      value: "/tmp/cv.pdf",
      matchedField: "resumePath",
    });
  });

  test("custom answers and answer bank fill free-form questions", () => {
    seq = 0;
    const elements = [
      field({ label: "Years of experience" }),
      field({ label: "Why do you want to work here?", tag: "textarea" }),
    ];
    const bank = new AnswerBank({ "Why do you want to work here?": "Mission alignment." });
    const out = planAutofill({ custom: { "years of experience": "8" } }, elements, bank);
    const byField = Object.fromEntries(out.map((s) => [s.matchedField, s.value]));
    expect(byField["custom:years of experience"]).toBe("8");
    // AnswerBank normalizes question keys to lowercase.
    expect(byField["custom:why do you want to work here?"]).toBe("Mission alignment.");
  });

  test("skips invisible fields and fields with no value", () => {
    seq = 0;
    const hidden = field({ label: "First Name" });
    hidden.bbox = { x: 0, y: 0, w: 0, h: 0 };
    const out = planAutofill({ firstName: "Ada", email: "" }, [hidden]);
    expect(out).toHaveLength(0);
  });
});

describe("autofillActions", () => {
  test("maps suggestion kinds to runner actions", () => {
    const actions = autofillActions([
      { index: 1, value: "Ada", kind: "text", matchedField: "firstName", matchedBy: "x" },
      { index: 2, value: "US", kind: "select", matchedField: "country", matchedBy: "x" },
      { index: 3, value: "/cv.pdf", kind: "file", matchedField: "resumePath", matchedBy: "x" },
    ]);
    expect(actions).toEqual([
      { name: "type", params: { index: 1, text: "Ada", mode: "replace" } },
      { name: "select_option", params: { index: 2, value: "US" } },
      { name: "upload_file", params: { index: 3, paths: ["/cv.pdf"] } },
    ]);
  });
});

describe("AnswerBank", () => {
  test("normalizes question keys and round-trips JSON", () => {
    const bank = new AnswerBank();
    bank.set("  Why   Us? ", "Because");
    expect(bank.get("why us?")).toBe("Because");
    expect(bank.has("WHY US?")).toBe(true);
    const restored = AnswerBank.fromJSON(bank.toJSON());
    expect(restored.get("why us?")).toBe("Because");
  });
});
