import { z } from "zod";
import { questionSemanticSchema } from "./matching-contracts";

export const questionOptionSchema = z.object({
  value: z.string().trim().min(1).max(200),
  label: z.string().trim().min(1).max(300),
  description: z.string().trim().max(500).optional(),
  recommended: z.boolean().optional(),
}).strict();
export const questionFieldSchema = z.object({
  id: z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/).refine(value => !["constructor", "prototype", "__proto__"].includes(value)),
  title: z.string().trim().min(1).max(200),
  type: z.enum(["radio", "checkbox", "select", "text", "textarea", "number", "switch"]),
  required: z.boolean().optional(),
  description: z.string().trim().max(500).optional(),
  placeholder: z.string().max(300).optional(),
  semantic: questionSemanticSchema.optional(),
  options: z.array(questionOptionSchema).min(1).max(128).optional(),
}).strict().superRefine((field, ctx) => {
  const choice = ["radio", "checkbox", "select"].includes(field.type);
  if (choice !== Boolean(field.options?.length)) ctx.addIssue({ code: "custom", message: "选择题必须提供选项，其他字段不能提供选项" });
  if (field.options && new Set(field.options.map(option => option.value)).size !== field.options.length) ctx.addIssue({ code: "custom", message: "选项值不能重复" });
});
export const questionFieldsSchema = z.array(questionFieldSchema).min(1).max(8).refine(fields => new Set(fields.map(field => field.id)).size === fields.length, "问题字段不能重复");
export const userQuestionSchema = z.object({
  title: z.string().trim().min(1).max(120),
  question: z.string().trim().min(1).max(4000),
  options: z.array(z.object({ value: z.string().min(1).max(200), label: z.string().min(1).max(300) }).strict()).min(2).max(4).optional(),
  fields: questionFieldsSchema.optional(),
}).strict().refine(value => Boolean(value.fields?.length) !== Boolean(value.options?.length), "使用 fields 或 options 其中一种提问方式");

export type QuestionField = z.infer<typeof questionFieldSchema>;
export type QuestionValue = string | string[] | number | boolean;
export const structuredQuestionAnswerSchema = z.union([
  z.object({ values: z.record(z.union([z.string().max(2000), z.array(z.string().max(200)).max(12), z.number().finite(), z.boolean()])), notes: z.record(z.string().max(2000)).optional(), note: z.string().max(2000).optional(), skippedFields: z.array(z.string().max(64)).max(8).optional() }).strict(),
  z.object({ skipped: z.literal(true) }).strict(),
]).refine(value => JSON.stringify(value).length <= 10000, "回答内容过长，请精简后提交");
export type QuestionAnswer = z.infer<typeof structuredQuestionAnswerSchema>;
export const mediaRevisionAnswerSchema = z.object({ revision: z.string().trim().min(1).max(4000) }).strict();
export type DecisionAnswer = string | QuestionAnswer | z.infer<typeof mediaRevisionAnswerSchema>;

/** Validate against the saved question, never against field definitions supplied by the browser. */
export function validateQuestionAnswer(fields: QuestionField[], input: unknown): QuestionAnswer {
  const answer = structuredQuestionAnswerSchema.parse(input);
  if ("skipped" in answer) return answer;
  if (Object.keys(answer.values).some(key => !fields.some(field => field.id === key))) throw new Error("回答包含不属于本次提问的字段");
  if (Object.keys(answer.notes || {}).some(key => !fields.some(field => field.id === key))) throw new Error("补充说明包含不属于本次提问的字段");
  if (answer.skippedFields && (new Set(answer.skippedFields).size !== answer.skippedFields.length || answer.skippedFields.some(id => !fields.some(field => field.id === id) || answer.values[id] !== undefined || answer.notes?.[id]?.trim()))) throw new Error("忽略的问题无效或已填写回答");
  for (const field of fields) {
    if (answer.skippedFields?.includes(field.id)) continue;
    const value = answer.values[field.id];
    const empty = value === undefined || typeof value === "string" && !value.trim() && ["text", "textarea", "radio", "select"].includes(field.type) || field.type === "checkbox" && Array.isArray(value) && !value.length;
    if (empty) {
      if (field.required && !answer.notes?.[field.id]?.trim()) throw new Error(`请填写“${field.title}”`);
      continue;
    }
    let valid = false;
    if (field.type === "checkbox") valid = Array.isArray(value) && new Set(value).size === value.length && value.every(item => field.options?.some(option => option.value === item));
    else if (field.type === "radio" || field.type === "select") valid = typeof value === "string" && Boolean(field.options?.some(option => option.value === value));
    else if (field.type === "number") valid = typeof value === "number" && Number.isFinite(value);
    else if (field.type === "switch") valid = typeof value === "boolean";
    else valid = typeof value === "string";
    if (!valid) throw new Error(`“${field.title}”的回答格式或选项无效`);
  }
  return answer;
}

export function describeDecisionAnswer(prompt: { fields?: QuestionField[]; options: { value: string; label: string }[] }, answer: unknown): { answer: string; skipped?: boolean; items?: { question: string; answer: string }[] } {
  const revision = mediaRevisionAnswerSchema.safeParse(answer);
  if (revision.success) return { answer: `修改需求：${revision.data.revision}` };
  const skipped = structuredQuestionAnswerSchema.safeParse(answer);
  if (skipped.success && "skipped" in skipped.data) return { answer: "用户跳过了本次提问；未确认任何选项，也未授权生成。", skipped: true };
  if (!prompt.fields?.length) return { answer: prompt.options.find(option => option.value === answer)?.label || String(answer) };
  const parsed = validateQuestionAnswer(prompt.fields, answer);
  if ("skipped" in parsed) return { answer: "用户跳过了本次提问；未确认任何选项，也未授权生成。", skipped: true };
  const items = prompt.fields.flatMap(field => {
    if (parsed.skippedFields?.includes(field.id)) return [{ question: field.title, answer: "已忽略，未确认此项" }];
    const value = parsed.values[field.id];
    const note = parsed.notes?.[field.id]?.trim();
    if (value === undefined || typeof value === "string" && !value.trim() || Array.isArray(value) && !value.length) return note ? [{ question: field.title, answer: note }] : [];
    const label = (item: QuestionValue) => field.options?.find(option => option.value === item)?.label || (typeof item === "boolean" ? item ? "是" : "否" : String(item));
    const selected = Array.isArray(value) ? value.map(label).join("、") : label(value);
    return [{ question: field.title, answer: note ? `${selected}\n补充说明：${note}` : selected }];
  });
  const lines = items.map(item => `${item.question}：${item.answer}`);
  if (parsed.note?.trim()) lines.push(`补充说明：${parsed.note.trim()}`);
  return { answer: lines.join("\n") || "用户未补充信息；未授权生成。", items: [...items, ...(parsed.note?.trim() ? [{ question: "补充说明", answer: parsed.note.trim() }] : [])] };
}
