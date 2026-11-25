import { describe, expect, it } from "vitest";
import { describeDecisionAnswer, userQuestionSchema, validateQuestionAnswer, type QuestionField } from "@/lib/creative-agent/questions";
import { modelGuidanceSummary, readModelGuidance } from "@/lib/creative-agent/model-guidance";
import { creativeAgentAnswerSchema } from "@/lib/creative-agent/schemas";

const fields: QuestionField[] = [
  { id: "model", title: "图片模型", type: "radio", required: true, options: [{ value: "gpt-image-2", label: "GPT Image", recommended: true }, { value: "seedream", label: "Seedream" }] },
  { id: "scope", title: "生成范围", type: "checkbox", required: true, options: [{ value: "people", label: "角色" }, { value: "scene", label: "场景" }] },
  { id: "appearance", title: "外观调整", type: "text" },
];
const answer = { values: { model: "gpt-image-2", scope: ["people"] }, note: "只做两张角色" };
describe("structured Agent questions", () => {
  it("accepts bounded revision feedback separately from generation approval", () => {
    const revision = { revision: "改成真实普通客厅" };
    expect(creativeAgentAnswerSchema.parse({ requestId: "a508c17a-2fdf-4f22-b48d-92e2d458e194", proposalHash: "hash", answer: revision }).answer).toEqual(revision);
    expect(describeDecisionAnswer({ options: [] }, revision).answer).toContain(revision.revision);
  });
  it("preserves explicit choices and optional text, and summarizes labels for the resumed conversation", () => {
    expect(validateQuestionAnswer(fields, answer)).toEqual(answer);
    expect(describeDecisionAnswer({ fields, options: [] }, answer).answer).toBe("图片模型：GPT Image\n生成范围：角色\n补充说明：只做两张角色");
    expect(creativeAgentAnswerSchema.parse({ requestId: "a508c17a-2fdf-4f22-b48d-92e2d458e194", proposalHash: "hash", answer }).answer).toEqual(answer);
  });
  it("accepts per-question custom answers without choices and keeps each answer under its own question", () => {
    const custom = { values: {}, notes: { model: "先不生成，整理提示词", scope: "角色和场景已经在画布上了", appearance: "保留服装" } };
    expect(validateQuestionAnswer(fields, custom)).toEqual(custom);
    expect(creativeAgentAnswerSchema.parse({ requestId: "a508c17a-2fdf-4f22-b48d-92e2d458e194", proposalHash: "hash", answer: custom }).answer).toEqual(custom);
    expect(describeDecisionAnswer({ fields, options: [] }, custom)).toEqual({
      answer: "图片模型：先不生成，整理提示词\n生成范围：角色和场景已经在画布上了\n外观调整：保留服装",
      items: [{ question: "图片模型", answer: "先不生成，整理提示词" }, { question: "生成范围", answer: "角色和场景已经在画布上了" }, { question: "外观调整", answer: "保留服装" }],
    });
  });
  it("includes supplementary details with the matching selected answer", () => {
    const custom = { values: answer.values, notes: { scope: "只做两张角色" } };
    expect(describeDecisionAnswer({ fields, options: [] }, custom).items).toEqual([{ question: "图片模型", answer: "GPT Image" }, { question: "生成范围", answer: "角色\n补充说明：只做两张角色" }]);
  });
  it.each([
    { values: {}, notes: { model: "  ", scope: "角色" } },
    { values: {}, note: "旧的整组说明不能替代各题答案" },
    { values: {}, notes: { model: "自定义" } },
    { values: answer.values, notes: { forged: "自定义" } },
    { values: answer.values, notes: { scope: "x".repeat(2001) } },
    { values: { ...answer.values, model: "unavailable-model" }, notes: { model: "不能掩盖无效选项" } },
    { values: { scope: ["people"] }, notes: { model: "已回答" }, skippedFields: ["model"] },
  ])("rejects empty, misattributed, oversized or contradictory custom answers %#", custom => {
    expect(() => validateQuestionAnswer(fields, custom)).toThrow();
  });
  it.each([
    { values: {} },
    { values: { model: "unavailable-model", scope: ["people"] } },
    { values: { model: ["gpt-image-2"], scope: ["people"] } },
    { values: { model: "gpt-image-2", scope: ["people", "people"] } },
    { ...answer, values: { ...answer.values, forgedField: "approve" } },
    { ...answer, approved: true },
  ])("rejects incomplete, forged, duplicate or wrong-typed answers %#", value => {
    expect(() => validateQuestionAnswer(fields, value)).toThrow();
  });
  it("treats skip separately and never fills recommended answers", () => {
    expect(validateQuestionAnswer(fields, { skipped: true })).toEqual({ skipped: true });
    expect(describeDecisionAnswer({ fields, options: [] }, { skipped: true })).toMatchObject({ skipped: true, answer: expect.stringContaining("未授权生成") });
    expect(() => validateQuestionAnswer(fields, { skipped: true, values: { model: "gpt-image-2" } })).toThrow();
  });
  it("accepts individual ignores without assigning a model and rejects forged or contradictory skips", () => {
    const partial = { values: { scope: ["people"] }, skippedFields: ["model"] };
    expect(validateQuestionAnswer(fields, partial)).toEqual(partial);
    expect(describeDecisionAnswer({ fields, options: [] }, partial).items).toEqual([{ question: "图片模型", answer: "已忽略，未确认此项" }, { question: "生成范围", answer: "角色" }]);
    for (const skippedFields of [["forged"], ["model", "model"], ["scope"]]) {
      expect(() => validateQuestionAnswer(fields, { ...partial, skippedFields })).toThrow();
    }
  });
  it("accepts explicit false and zero while rejecting invalid number/boolean types", () => {
    const typed: QuestionField[] = [{ id: "sound", title: "声音", type: "switch", required: true }, { id: "count", title: "数量", type: "number", required: true }];
    expect(validateQuestionAnswer(typed, { values: { sound: false, count: 0 } })).toEqual({ values: { sound: false, count: 0 } });
    expect(() => validateQuestionAnswer(typed, { values: { sound: "false", count: 0 } })).toThrow();
  });
  it("rejects duplicate fields, missing choice options and ambiguous top-level formats", () => {
    const question = { title: "确认创作方向", question: "选择模型和范围", fields };
    expect(userQuestionSchema.safeParse(question).success).toBe(true);
    expect(userQuestionSchema.safeParse({ ...question, fields: [fields[0], fields[0]] }).success).toBe(false);
    expect(userQuestionSchema.safeParse({ ...question, fields: [{ ...fields[0], options: undefined }] }).success).toBe(false);
    expect(userQuestionSchema.safeParse({ ...question, options: fields[0].options }).success).toBe(false);
  });
  it("keeps existing fixed approval summaries compatible", () => {
    expect(describeDecisionAnswer({ options: [{ value: "approve", label: "确认生成" }] }, "approve")).toEqual({ answer: "确认生成" });
  });
});

describe("model-specific guidance evidence", () => {
  it.each([
    ["gpt-image-2-apimart", "image", "gpt_image"],
    ["gpt-image-2.5-reapi::sunburst", "image", "gpt_image_25"],
    ["nano-banana-pro", "image", "gemini_image"],
    ["doubao-seedream-5.0-lite", "image", "seedream"],
    ["doubao-seedream-5.0-pro", "image", "seedream_5_pro"],
    ["doubao-seedance-2-0-fast-260128", "video", "seedance_2_0"],
    ["doubao-seedance-2.5", "video", "seedance_2_5"],
  ] as const)("maps %s without changing runtime capabilities", (id, kind, profile) => {
    const result = readModelGuidance(id, kind);
    expect(result.profileId).toBe(profile);
    expect(result.sources.length).toBeGreaterThan(0);
    expect(result.sources[0]).toMatchObject({ url: expect.stringMatching(/^https:\/\//), checkedAt: "2026-10-14" });
    expect(result.localComparativeEvidence).toEqual([]);
    expect(result).not.toHaveProperty("maxDurationSeconds");
  });
  it("does not infer official traits for unknown models or wrong media types", () => {
    expect(modelGuidanceSummary("gpt-image-99", "image")).toMatchObject({ profileId: null, basis: "unverified" });
    expect(readModelGuidance("unverified-model", "video").sources).toEqual([]);
    expect(modelGuidanceSummary("doubao-seedance-2.5", "image").profileId).toBeNull();
  });
});
