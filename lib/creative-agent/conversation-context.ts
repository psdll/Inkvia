import { z } from "zod";
import type { CreativeAgentReference } from "./contracts";
import type { Run } from "./store-types";
import { CreativeAgentError } from "./errors";
import { parseCreativeSkillCommand } from "./skill-command";
import { requirementSourceSchema } from "./matching-contracts";

export type ConversationContext = {
  version: 1;
  skillId: string | null;
  referenceAnchor: { runId: string; messageId: string; references: CreativeAgentReference[]; referenceVersions?: { nodeId: string; contentVersion: string }[] } | null;
  latestRequestActionId: string | null;
};
export const emptyConversationContext = (): ConversationContext => ({ version: 1, skillId: null, referenceAnchor: null, latestRequestActionId: null });
export function resolveConversationSkill(text: string, selected: string | null | undefined, context: ConversationContext) {
  const command = parseCreativeSkillCommand(text);
  const canonical = command && /^(system|personal):[1-9]\d*$/.test(command.skillId) ? command.skillId : undefined;
  if (selected !== undefined && command && selected !== command.skillId) throw new CreativeAgentError("SKILL_SELECTION_CONFLICT", "技能指令与当前选择不一致，请保留一个明确选择。", 400);
  return selected !== undefined ? selected : canonical ?? context.skillId;
}
export const subjectIntentSchema = z.object({ mode: z.enum(["clear", "replace", "combine"]), source: requirementSourceSchema }).strict();
export type SubjectIntent = z.infer<typeof subjectIntentSchema>;
export function validatedSubjectIntent(run: Run, value: unknown): SubjectIntent | undefined {
  if (value === undefined) return;
  const intent = subjectIntentSchema.parse(value);
  const source = intent.source;
  const text = run.input.text;
  const start = source.start ?? text.indexOf(source.quote), end = source.end ?? start + source.quote.length;
  if (source.kind !== "message" || source.sourceId !== run.input.messageId || source.fieldId || source.channel || start < 0 || text.slice(start, end) !== source.quote || end - start !== source.quote.length || source.start === undefined && text.indexOf(source.quote, start + 1) !== -1)
    throw new CreativeAgentError("SUBJECT_SOURCE_INVALID", "主体变更必须引用本轮用户原文及准确 UTF-16 位置，不能从空引用或历史内容推断。", 400);
  return { ...intent, source: { ...source, start, end } };
}
export const isConversationMediaReference = (reference: CreativeAgentReference) => ["image", "video", "audio", "imageTask", "videoTask", "audioTask", "media"].includes(reference.kind);
export const mediaReference = ({ nodeId, semanticHash, batchId, outputId, mediaId, generationId }: CreativeAgentReference) => ({ nodeId, semanticHash, ...(batchId ? { batchId } : {}), ...(outputId ? { outputId } : {}), ...(mediaId ? { mediaId } : {}), ...(generationId ? { generationId } : {}) });
const identity = (ref: Record<string, unknown>) => JSON.stringify([ref.nodeId, ref.semanticHash, ref.batchId, ref.outputId, ref.mediaId, ref.generationId]);
export function sameConversationReferences(left: CreativeAgentReference[], right: CreativeAgentReference[]) {
  return left.length === right.length && left.every(ref => right.some(other => identity(mediaReference(ref)) === identity(mediaReference(other))));
}
/** Source references are defaults, not output-edit targets or execution permission. */
export function conversationMediaArgs(run: Run, raw: Record<string, unknown>): Record<string, unknown> & { references?: Record<string, unknown>[] } {
  const { subject, ...args } = raw;
  const intent = validatedSubjectIntent(run, subject);
  const selected = (run.input.preparedSelection?.references ?? run.input.selection.references).filter(isConversationMediaReference);
  const current = run.input.conversationContext ? run.input.conversationContext.referenceAnchor?.references ?? [] : selected;
  const defaults = current.map(mediaReference);
  const supplied = Array.isArray(args.references) ? args.references as Record<string, unknown>[] : undefined;
  if (intent?.mode === "clear") {
    if (supplied?.length) throw new CreativeAgentError("SUBJECT_REFERENCE_CONFLICT", "不用参考图的请求不能同时传入引用。", 400);
    return { ...args, references: [] };
  }
  if (intent?.mode === "replace") return { ...args, references: supplied ?? [] };
  if (intent?.mode === "combine") return { ...args, references: [...new Map([...defaults, ...supplied ?? []].map(ref => [identity(ref), ref])).values()] };
  // Verified output-edit continuation has its own exact source/output contract.
  if (run.input.requirements?.continuation) return args;
  if (!defaults.length) return args;
  if (supplied?.length && (supplied.length !== defaults.length || supplied.some(ref => !defaults.some(item => Object.entries(ref).every(([key, value]) => value === (item as Record<string, unknown>)[key])))))
    throw new CreativeAgentError("SUBJECT_REFERENCE_CONFLICT", "本对话当前主体引用必须保持完整准确；用户明确换主体或合并时，用 subject 携带本轮原文依据。", 400);
  return { ...args, references: defaults };
}
export const conversationContextPolicy = "本对话当前创作语境：所选技能持续生效，历史技能不代表当前选择；当前原文与偏好优先。当前源引用为默认创作主体，换背景/光线/视角沿用整组原版本，完整prompt须保留主体；新上传/选择替换旧组。明确不用产品/参考或独立新主体时，subject用clear/replace并引用本轮原文source；仅准备或停用也用generation_requirements/plan记录，直接生成内联subject；明确合并才用combine。省略references不是清除。最近请求只证明实际提交，非用户采用/成功，不继承数量、重试或执行授权；当前修改覆盖旧细节。";

export function assertConversationReferenceVersions(run: Run, receipt: import("./matching").SelectionReceipt) {
  for (const expected of run.input.conversationContext?.referenceAnchor?.referenceVersions ?? []) {
    const current = receipt.referenceVersions.find(ref => ref.nodeId === expected.nodeId);
    if (current && current.contentVersion !== expected.contentVersion) throw new CreativeAgentError("REFERENCE_CHANGED", "本对话当前主体素材内容已变化，请重新选择引用后继续。", 409);
  }
}

export function anchorWithReceiptVersions(anchor: ConversationContext["referenceAnchor"], receipt: import("./matching").SelectionReceipt | undefined): ConversationContext["referenceAnchor"] {
  if (!anchor || !receipt?.referenceVersions) return anchor;
  const versions = new Map((anchor.referenceVersions ?? []).map(version => [version.nodeId, version]));
  for (const version of receipt.referenceVersions) {
    const original = anchor.references.find(ref => ref.nodeId === version.nodeId);
    const requested = receipt.request.references.find(ref => ref.nodeId === version.nodeId);
    if (original && requested && Object.entries(mediaReference(original)).every(([key, value]) => value === requested[key])) versions.set(version.nodeId, version);
  }
  return versions.size ? { ...anchor, referenceVersions: [...versions.values()] } : anchor;
}
