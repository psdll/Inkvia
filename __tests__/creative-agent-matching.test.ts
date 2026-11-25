import { describe, expect, it } from "vitest";
import * as matching from "@/lib/creative-agent/matching-contracts";
import { buildCreativeSystemPrompt } from "@/lib/creative-agent/skills";
import type { Run } from "@/lib/creative-agent/store-types";

const saved = { image: { mode: "explicit" as const, model: "default-model", params: { aspectRatio: "16:9", resolution: "1K" } } };
const message = "本次用 chosen-model，1:1、2K，不改默认偏好";
const source = (quote: string) => ({ kind: "message" as const, sourceId: "m", start: message.indexOf(quote), end: message.indexOf(quote) + quote.length, quote });
const fact = (field: string, value: unknown, quote: string) => ({ field, value, strength: "hard", source: source(quote) });
const evidence = [{ kind: "message" as const, sourceId: "m", text: message }];
const field = (id: string, requirement: string, purpose: matching.QuestionSemantic["purpose"] = "missing_input") => ({ id, title: "请选择", type: "text" as const, semantic: { purpose, requirement: requirement as matching.QuestionSemantic["requirement"], unresolvedId: requirement, revision: 0 } });

describe("v2 per-turn requirements", () => {
  it("defaults new effective media to auto while preserving explicit and legacy fields", () => {
    expect(matching.newMatchingPreferences({})).toEqual({ image: { mode: "auto" }, video: { mode: "auto" } });
    expect(matching.newMatchingPreferences({ imageModel: "legacy" })).toEqual({ image: { mode: "explicit", model: "legacy" }, video: { mode: "auto" } });
    expect(matching.newMatchingPreferences({ ...saved, imageModel: "ignored" }).image).toEqual(saved.image);
  });
  it("merges verified temporary model and parameters field by field without changing saved defaults", () => {
    const state = matching.mergeTurnRequirements(saved, undefined, { facts: [fact("image.modelChoice", { mode: "explicit", model: "chosen-model" }, "chosen-model"), fact("image.params.aspectRatio", "1:1", "1:1"), fact("image.params.resolution", "2K", "2K")] }, evidence);
    expect(state.effectivePreferences.image).toEqual({ mode: "explicit", model: "chosen-model", params: { aspectRatio: "1:1", resolution: "2K" } });
    expect(saved.image.model).toBe("default-model"); expect(saved.image.params.resolution).toBe("1K");
    expect(state.revision).toBe(1);
    expect(matching.mergeTurnRequirements(saved, state, { facts: state.facts }, evidence).revision).toBe(1);
  });
  it("supports explicit auto delegation over a saved model without clearing other constraints", () => {
    const state = matching.mergeTurnRequirements(saved, undefined, { facts: [{ field: "image.modelChoice", value: { mode: "auto" }, strength: "hard", source: { kind: "message", sourceId: "m", start: 0, end: 4, quote: "你来决定" } }] }, [{ kind: "message", sourceId: "m", text: "你来决定" }]);
    expect(state.effectivePreferences.image).toEqual({ mode: "auto", params: saved.image.params });
  });
  it.each([
    { field: "image.params.resolution", value: "4K", strength: "hard", source: source("2K") },
    { ...fact("image.params.resolution", "2K", "2K"), source: { ...source("2K"), sourceId: "assistant" } },
    { ...fact("image.params.resolution", "2K", "2K"), source: { ...source("2K"), kind: "attachment" } },
    { ...fact("image.params.resolution", "2K", "2K"), source: { ...source("2K"), start: 0 } },
  ])("rejects forged source or value evidence %#", invalid => {
    expect(() => matching.mergeTurnRequirements(saved, undefined, { facts: [invalid] }, evidence)).toThrow();
  });
  it("rejects a directly negated explicit model and mismatched numeric evidence", () => {
    for (const [text, field, value] of [["不要 chosen-model", "image.modelChoice", { mode: "explicit", model: "chosen-model" }], ["总共 2 张", "image.quantity", 3]] as const) {
      expect(() => matching.mergeTurnRequirements(saved, undefined, { facts: [{ field, value, strength: "hard", source: { kind: "message", sourceId: "m", start: 0, end: text.length, quote: text } }] }, [{ kind: "message", sourceId: "m", text }])).toThrow();
    }
  });
  it("retains true same-layer conflicts instead of silently choosing the last value", () => {
    const text = "1:1 和 16:9";
    const state = matching.mergeTurnRequirements(saved, undefined, { facts: ["1:1", "16:9"].map(value => ({ field: "image.params.aspectRatio", value, strength: "hard", source: { kind: "message", sourceId: "m", start: text.indexOf(value), end: text.indexOf(value) + value.length, quote: value } })) }, [{ kind: "message", sourceId: "m", text }]);
    expect(state.conflicts).toContain("image.params.aspectRatio");
  });
  it("accepts answer notes as fresh evidence and retains unrelated defaults", () => {
    const quote = "改成 2K";
    const state = matching.mergeTurnRequirements(saved, undefined, { facts: [{ field: "image.params.resolution", value: "2K", strength: "hard", source: { kind: "answer", sourceId: "decision", fieldId: "custom", channel: "notes", start: 0, end: quote.length, quote } }] }, [{ kind: "answer", sourceId: "decision", fieldId: "custom", channel: "notes", text: quote }]);
    expect(state.effectivePreferences.image?.params).toEqual({ aspectRatio: "16:9", resolution: "2K" });
  });
});

describe("semantic questions", () => {
  it("filters model selection and known params despite changed UI IDs but retains necessary questions", () => {
    const fields = [field("preferredEngine", "image.modelChoice"), field("otherRatioId", "image.params.aspectRatio"), field("ref", "references.product"), field("target", "target", "target_ambiguity"), field("budget", "spending", "budget_change")];
    expect(matching.filterSemanticQuestions(fields, matching.newMatchingPreferences(saved), { revision: 0, conflicts: [] }, []).map(item => item.id)).toEqual(["ref", "target", "budget"]);
  });
  it("keeps real conflicts and unavailable requirements even for an otherwise known field", () => {
    const fields = [field("conflict", "image.params.aspectRatio", "hard_conflict"), field("missing", "image.modelChoice", "unavailable_requirement")];
    expect(matching.filterSemanticQuestions(fields, matching.newMatchingPreferences(saved), { revision: 0, conflicts: ["image.params.aspectRatio"], unavailable: ["image.modelChoice"] }, [])).toHaveLength(2);
  });
  it("suppresses an already asked unresolved ID only at its requirement revision", () => {
    const fields = [field("newId", "references.product")];
    expect(matching.filterSemanticQuestions(fields, matching.newMatchingPreferences(), { revision: 0, conflicts: [] }, [fields[0].semantic])).toEqual([]);
    expect(matching.filterSemanticQuestions([{ ...fields[0], semantic: { ...fields[0].semantic, revision: 1 } }], matching.newMatchingPreferences(), { revision: 1, conflicts: [] }, [fields[0].semantic])).toHaveLength(1);
  });
  it("rejects missing semantic metadata and stale revisions on v2 questions", () => {
    expect(() => matching.filterSemanticQuestions([{ semantic: undefined }], matching.newMatchingPreferences(), { revision: 0, conflicts: [] }, [])).toThrow();
    expect(() => matching.filterSemanticQuestions([field("x", "target")], matching.newMatchingPreferences(), { revision: 1, conflicts: [] }, [])).toThrow();
  });
  it("new prompt suppresses text-based redundant model questions while legacy prompt is preserved", () => {
    const run = { input: { preferences: {} } } as Run;
    expect(buildCreativeSystemPrompt(run)).toContain("缺失表示旧未选择状态");
    const current = buildCreativeSystemPrompt({ ...run, input: { ...run.input, matchingPolicyVersion: 2 } });
    expect(current).not.toContain("缺失表示旧未选择状态");
    expect(current).toContain("普通回复"); expect(current).toContain("generation_requirements");
  });
});

it("does not let invented conflict purpose or renamed unresolved IDs bypass known facts", () => {
  expect(matching.filterSemanticQuestions([field("fake", "image.modelChoice", "hard_conflict")], matching.newMatchingPreferences(saved), { revision: 0, conflicts: [] }, [])).toEqual([]);
  const question = field("changed", "references.product"); question.semantic.unresolvedId = "new-wording";
  expect(matching.filterSemanticQuestions([question], matching.newMatchingPreferences(), { revision: 0, conflicts: [] }, [field("old", "references.product").semantic])).toEqual([]);
});
it("does not accept a partial model or parameter token as direct evidence", () => {
  for (const [text, field, value] of [["use chosen-model-v2", "image.modelChoice", { mode: "explicit", model: "chosen-model" }], ["12K", "image.params.resolution", "2K"]] as const) {
    expect(() => matching.mergeTurnRequirements(saved, undefined, { facts: [{ field, value, strength: "hard", source: { kind: "message", sourceId: "m", start: 0, end: text.length, quote: text } }] }, [{ kind: "message", sourceId: "m", text }])).toThrow();
  }
});
it("does not repeat unrelated skipped questions after changing a separate field", () => {
  const state = matching.mergeTurnRequirements(saved, undefined, { facts: [fact("image.params.resolution", "2K", "2K")] }, evidence);
  const question = field("ref", "references.product"); question.semantic.revision = state.revision;
  expect(matching.filterSemanticQuestions([question], state.effectivePreferences, state, [field("old", "references.product").semantic])).toEqual([]);
});

it.each([
  ["严格只要一张", "image.quantity", 1], ["两秒", "video.params.duration", 2], ["正方形", "image.params.aspectRatio", "1:1"], ["十六比九", "video.params.ratio", "16:9"],
])("normalizes direct natural-language scalar evidence %s", (text, field, value) => {
  const state = matching.mergeTurnRequirements(saved, undefined, { facts: [{ field, value, strength: "hard", source: { kind: "message", sourceId: "m", quote: text } }] }, [{ kind: "message", sourceId: "m", text }]);
  expect(state.facts[0].value).toEqual(value); expect(state.facts[0].source).toMatchObject({ start: 0, end: text.length });
});
it("retains an unresolved visible model label for catalog resolution without inventing a stable ID", () => {
  const text = "这次用轻量版";
  const state = matching.mergeTurnRequirements(saved, undefined, { facts: [{ field: "image.modelChoice", value: { mode: "explicit", unresolvedAlias: "轻量版" }, strength: "hard", source: { kind: "message", sourceId: "m", quote: text } }] }, [{ kind: "message", sourceId: "m", text }]);
  expect(state.effectivePreferences.image).toMatchObject({ mode: "explicit", unresolvedAlias: "轻量版" });
  expect(state.effectivePreferences.image.model).toBeUndefined();
});
it("requires disambiguated source offsets when the same quote appears twice", () => {
  expect(() => matching.mergeTurnRequirements(saved, undefined, { facts: [{ field: "image.quantity", value: 1, strength: "hard", source: { kind: "message", sourceId: "m", quote: "一张" } }] }, [{ kind: "message", sourceId: "m", text: "原来一张，这次一张" }])).toThrow();
});
it.each([
  ["不要自动选", "image.modelChoice", { mode: "auto" }], ["不需要声音", "video.params.generateAudio", true], ["需要声音", "video.params.generateAudio", false],
])("does not reverse direct negative or boolean evidence %s", (text, field, value) => {
  expect(() => matching.mergeTurnRequirements(saved, undefined, { facts: [{ field, value, strength: "hard", source: { kind: "message", sourceId: "m", quote: text } }] }, [{ kind: "message", sourceId: "m", text }])).toThrow();
});
it("does not let unavailable_requirement invent a known model conflict", () => {
  expect(matching.filterSemanticQuestions([field("rename", "image.modelChoice", "unavailable_requirement")], matching.newMatchingPreferences(saved), { revision: 0, conflicts: [] }, [])).toEqual([]);
});

it("never reverts a newer trusted answer when an old answer is replayed", () => {
  const sources = [{ kind: "answer" as const, sourceId: "old", fieldId: "size", channel: "notes" as const, text: "2K", order: 10 }, { kind: "answer" as const, sourceId: "new", fieldId: "size", channel: "notes" as const, text: "4K", order: 20 }];
  const f = (sourceId: string, value: string) => ({ field: "image.params.resolution", value, strength: "hard", source: { kind: "answer", sourceId, fieldId: "size", channel: "notes", quote: value } });
  const initial = matching.mergeTurnRequirements(saved, undefined, { facts: [f("new", "4K")] }, sources);
  const replay = matching.mergeTurnRequirements(saved, initial, { facts: [f("old", "2K")] }, sources);
  expect(replay.effectivePreferences.image.params?.resolution).toBe("4K");
});
it("recognizes an explicit same-message correction without treating both clauses as simultaneous hard requirements", () => {
  const text = "原来4K，改为2K";
  const facts = ["4K", "2K"].map(value => ({ field: "image.params.resolution", value, strength: "hard", source: { kind: "message", sourceId: "m", quote: value } }));
  const state = matching.mergeTurnRequirements(saved, undefined, { facts }, [{ kind: "message", sourceId: "m", text }]);
  expect(state.conflicts).toEqual([]); expect(state.effectivePreferences.image.params?.resolution).toBe("2K");
});

it.each(["budget_change", "target_ambiguity"] as const)("cannot repackage a known model question as %s", purpose => {
  expect(() => matching.filterSemanticQuestions([field("engine", "image.modelChoice", purpose)], matching.newMatchingPreferences(saved), { revision: 0, conflicts: [] }, [])).toThrow();
});
it("keeps unavailable evidence on an idempotent requirements replay", () => {
  const facts = [fact("image.params.resolution", "2K", "2K")];
  const state = matching.mergeTurnRequirements(saved, undefined, { facts }, evidence);
  const rejected = { ...state, unavailable: ["image.params"] };
  expect(matching.mergeTurnRequirements(saved, rejected, { facts }, evidence).unavailable).toEqual(["image.params"]);
});

it("rejects negated normalized scalar evidence", () => {
  for (const [text, field, value] of [["不要正方形", "image.params.aspectRatio", "1:1"], ["不要两秒", "video.params.duration", 2]] as const) {
    expect(() => matching.mergeTurnRequirements(saved, undefined, { facts: [{ field, value, strength: "hard", source: { kind: "message", sourceId: "m", quote: text } }] }, [{ kind: "message", sourceId: "m", text }])).toThrow();
  }
});

it("does not hide negation by quoting only the positive audio clause", () => {
  expect(() => matching.mergeTurnRequirements(saved, undefined, { facts: [{ field: "video.params.generateAudio", value: true, strength: "hard", source: { kind: "message", sourceId: "m", quote: "需要声音" } }] }, [{ kind: "message", sourceId: "m", text: "不需要声音" }])).toThrow();
});

it("does not revise requirements just because the LLM quotes the same value differently", () => {
  const initial = matching.mergeTurnRequirements(saved, undefined, { facts: [fact("image.params.resolution", "2K", "2K")] }, evidence);
  const repeated = matching.mergeTurnRequirements(saved, initial, { facts: [fact("image.params.resolution", "2K", "1:1、2K")] }, evidence);
  expect(repeated.revision).toBe(initial.revision);
  expect(repeated.fieldRevisions).toEqual(initial.fieldRevisions);
});

describe("Task 1 review regression contracts", () => {
  it.each(["image", "video"])("permits %s parameter leaf questions backed by parent broker evidence", media => {
    const question = field("resolution", `${media}.params.resolution`, "unavailable_requirement");
    expect(matching.filterSemanticQuestions([question], matching.newMatchingPreferences(saved), { revision: 0, conflicts: [], unavailable: [`${media}.params`] }, [])).toEqual([question]);
    expect(matching.filterSemanticQuestions([field("foreign", `${media === "image" ? "video" : "image"}.params.resolution`, "unavailable_requirement")], matching.newMatchingPreferences(saved), { revision: 0, conflicts: [], unavailable: [`${media}.params`] }, [])).toEqual([]);
  });
  it.each(["不要随便选", "不要你来决定", "别让你来决定", "不要再自动选"])("does not turn %s into auto delegation", text => {
    for (const quote of [text, text.replace(/^(?:不要再|不要|别让)/, "")]) {
      expect(() => matching.mergeTurnRequirements(saved, undefined, { facts: [{ field: "image.modelChoice", value: { mode: "auto" }, strength: "hard", source: { kind: "message", sourceId: "m", quote } }] }, [{ kind: "message", sourceId: "m", text }])).toThrow();
    }
  });
  it.each(["2K", "改为2K", "原来4K，改为2K"])("resolves the same correction meaning for source quote %s", quote => {
    const text = "原来4K，改为2K";
    const facts = [
      { field: "image.params.resolution", value: "4K", strength: "hard", source: { kind: "message", sourceId: "m", quote: "4K" } },
      { field: "image.params.resolution", value: "2K", strength: "hard", source: { kind: "message", sourceId: "m", quote } },
    ];
    const state = matching.mergeTurnRequirements(saved, undefined, { facts }, [{ kind: "message", sourceId: "m", text }]);
    expect(state.conflicts).toEqual([]); expect(state.effectivePreferences.image.params?.resolution).toBe("2K");
    const narrow = matching.mergeTurnRequirements(saved, state, { facts: [{ ...facts[1], source: { ...facts[1].source, quote: "2K" } }] }, [{ kind: "message", sourceId: "m", text }]);
    expect(narrow.revision).toBe(state.revision);
  });
  it.each(["image.model", "preferredEngine", "video.engine", "image.params.engine", "model", "references.preferredEngine"])("rejects noncanonical requirement %s while retaining arbitrary UI IDs", requirement => {
    expect(() => matching.filterSemanticQuestions([field("anyUiId", requirement)], matching.newMatchingPreferences(), { revision: 0, conflicts: [] }, [])).toThrow();
  });
  it.each(["target_ambiguity", "budget_change"] as const)("rejects parameter questions mislabeled %s", purpose => {
    expect(() => matching.filterSemanticQuestions([field("ratio", "image.params.aspectRatio", purpose)], matching.newMatchingPreferences(saved), { revision: 0, conflicts: [] }, [])).toThrow();
  });
  it("keeps necessary reference, target and spending decisions within the canonical registry", () => {
    const fields = [field("refUi", "references.product"), field("targetUi", "target.output", "target_ambiguity"), field("budgetUi", "spending.maxPaidCalls", "budget_change")];
    expect(matching.filterSemanticQuestions(fields, matching.newMatchingPreferences(), { revision: 0, conflicts: [] }, [])).toEqual(fields);
  });
  it("retains soft alternatives without turning either into a hard parameter or blocking conflict", () => {
    const text = "16:9 或 1:1 都可以";
    const facts = ["16:9", "1:1"].map(value => ({ field: "image.params.aspectRatio", value, strength: "soft", source: { kind: "message", sourceId: "m", quote: value } }));
    const state = matching.mergeTurnRequirements({}, undefined, { facts }, [{ kind: "message", sourceId: "m", text }]);
    expect(state.conflicts).toEqual([]); expect(state.facts).toHaveLength(2);
    expect(state.facts.every(item => item.strength === "soft")).toBe(true);
    expect(state.effectivePreferences.image.params?.aspectRatio).toBeUndefined();
  });
  it("uses the hard value when a same-layer soft preference differs", () => {
    const text = "最好16:9，必须1:1";
    const facts = [{ value: "16:9", strength: "soft" }, { value: "1:1", strength: "hard" }].map(item => ({ field: "image.params.aspectRatio", ...item, source: { kind: "message", sourceId: "m", quote: item.value } }));
    const state = matching.mergeTurnRequirements({}, undefined, { facts }, [{ kind: "message", sourceId: "m", text }]);
    expect(state.conflicts).toEqual([]); expect(state.effectivePreferences.image.params?.aspectRatio).toBe("1:1");
    expect(state.facts).toHaveLength(2);
  });
});

it('normalizes current catalog labels before validating literal evidence while preserving negative and ambiguous labels', () => {
 const options = { 'image.params.background': [{ value: 'transparent', label: '透明' }, { value: 'opaque', label: '不透明' }], 'image.params.quality': [{ value: 'high', label: '高' }, { value: 'xhigh', label: '超高' }] };
 const merge = (text: string, field: string, value: string) => matching.mergeTurnRequirements(undefined, undefined, { facts: [{ field, value, strength: 'hard', source: { kind: 'message', sourceId: 'm', quote: text } }] }, [{ kind: 'message', sourceId: 'm', text }], options);
 expect(merge('透明背景', 'image.params.background', 'transparent').effectivePreferences.image.params?.background).toBe('transparent');
 expect(merge('高质量', 'image.params.quality', 'high').effectivePreferences.image.params?.quality).toBe('high');
 expect(merge('透明背景', 'image.params.background', '透明').effectivePreferences.image.params?.background).toBe('transparent');
 expect(() => merge('不要透明背景', 'image.params.background', 'transparent')).toThrow();
 expect(() => merge('不透明背景', 'image.params.background', 'transparent')).toThrow();
 expect(() => merge('超高质量', 'image.params.quality', 'high')).toThrow();
});

it('does not let a narrowed option-label quote reverse opaque into transparent', () => {
 const options = { 'image.params.background': [{ value: 'transparent', label: '透明' }, { value: 'opaque', label: '不透明' }] };
 expect(() => matching.mergeTurnRequirements(undefined, undefined, { facts: [{ field: 'image.params.background', value: '透明', strength: 'hard', source: { kind: 'message', sourceId: 'm', quote: '透明' } }] }, [{ kind: 'message', sourceId: 'm', text: '不透明背景' }], options)).toThrow();
});
