import { z } from "zod";
import { resolveCreativeAgentPreferences, type CreativeAgentPreferences } from "./preferences";

export const requirementFields = ["image.modelChoice", "video.modelChoice", "image.params.aspectRatio", "image.params.resolution", "image.params.quality", "image.params.background", "video.params.ratio", "video.params.resolution", "video.params.duration", "video.params.generateAudio", "image.quantity", "video.quantity", "generation.finalOutputs", "generation.intermediateOutputs", "generation.totalOutputs", "generation.initialCalls", "generation.retryCalls", "generation.totalCalls", "intent"] as const;
export const questionRequirementFields = [...requirementFields, "image.params", "video.params", "references", "references.product", "references.character", "references.style", "references.scene", "references.image", "references.video", "references.audio", "target", "target.node", "target.output", "target.scope", "target.operation", "spending", "spending.maxPaidCalls", "spending.additionalSteps"] as const;
/** Broker parameter failures can cover a combination; only that media's known leaves belong to it. */
export function requirementContains(scope: string | undefined, field: string) {
  return scope === field || (scope === "image.params" || scope === "video.params") && requirementFields.some(item => item === field && item.startsWith(`${scope}.`));
}
export const requirementSourceSchema = z.object({
  kind: z.enum(["message", "answer"]), sourceId: z.string().min(1).max(256),
  fieldId: z.string().min(1).max(64).optional(), channel: z.enum(["values", "notes", "revision"]).optional(),
  start: z.number().int().min(0).optional(), end: z.number().int().positive().optional(), quote: z.string().min(1).max(4000),
  order: z.number().finite().optional(), correction: z.boolean().optional(), valueStart: z.number().int().min(0).optional(),
  quantityEvidenceVersion: z.union([z.literal(1), z.literal(2)]).optional(),
}).strict();
const modelChoiceSchema = z.union([
  z.object({ mode: z.literal("auto") }).strict(),
  z.object({ mode: z.literal("explicit"), model: z.string().min(1).max(256) }).strict(),
  z.object({ mode: z.literal("explicit"), unresolvedAlias: z.string().min(1).max(256) }).strict(),
]);
export const requirementFactSchema = z.object({
  field: z.enum(requirementFields), value: z.union([z.string().min(1).max(256), z.number().finite(), z.boolean(), modelChoiceSchema]),
  strength: z.enum(["hard", "soft"]), source: requirementSourceSchema,
}).strict().superRefine((fact, ctx) => {
  const valid = fact.field.endsWith("modelChoice") ? modelChoiceSchema.safeParse(fact.value).success
    : fact.field.endsWith("duration") || fact.field.endsWith("quantity") || fact.field.startsWith("generation.") ? typeof fact.value === "number" && Number.isSafeInteger(fact.value) && (fact.field.startsWith("generation.") ? fact.value >= 0 : fact.value > 0)
    : fact.field.endsWith("generateAudio") ? typeof fact.value === "boolean"
    : fact.field === "intent" ? ["discuss", "prepare", "generate", "edit", "inspect"].includes(String(fact.value))
    : typeof fact.value === "string";
  if (!valid) {
    const expected = fact.field.endsWith("modelChoice") ? "modelChoice 对象：{mode:auto} 或 {mode:explicit, model/unresolvedAlias:string}"
      : fact.field.startsWith("generation.") ? "非负整数 number"
      : fact.field.endsWith("duration") || fact.field.endsWith("quantity") ? "正整数 number"
      : fact.field.endsWith("generateAudio") ? "boolean"
      : fact.field === "intent" ? "枚举 discuss/prepare/generate/edit/inspect；创意描述放入 prompt" : "非空 string";
    ctx.addIssue({ code: "custom", path: ["value"], message: `${fact.field} 的 value 应为 ${expected}，不得通过类型转换补造要求` });
  }
});
export const turnRequirementsSchema = z.object({ facts: z.array(requirementFactSchema).max(64) }).strict();
export type RequirementFact = z.infer<typeof requirementFactSchema>;
export type RequirementEvidence = { kind: "message" | "answer"; sourceId: string; fieldId?: string; channel?: "values" | "notes" | "revision"; text: string; order?: number; typedAnswer?: { requirement: string; type: "number" | "radio" | "select"; value: number | string; title: string; description?: string; singleQuestion?: string; choiceLabel?: string } };
export type TurnRequirements = {
  version: 1; revision: number; fieldRevisions: Record<string, number>; unavailable?: string[]; facts: RequirementFact[]; conflicts: string[];
  effectivePreferences: ReturnType<typeof newMatchingPreferences>;
  continuation?: import("./continuation").VerifiedContinuation;
  composedQuantities?: Record<string, { value: number; evidence: string[] }>;
};
export const questionSemanticSchema = z.object({
  purpose: z.enum(["missing_input", "target_ambiguity", "hard_conflict", "unavailable_requirement", "budget_change"]),
  requirement: z.enum(questionRequirementFields),
  unresolvedId: z.string().min(1).max(128), revision: z.number().int().min(0),
}).strict().superRefine((semantic, ctx) => {
  if (semantic.purpose === "target_ambiguity" && semantic.requirement !== "target" && !semantic.requirement.startsWith("target.") || semantic.purpose === "budget_change" && semantic.requirement !== "spending" && !semantic.requirement.startsWith("spending.")) ctx.addIssue({ code: "custom", message: "问题目的与需求字段不匹配" });
});
export type QuestionSemantic = z.infer<typeof questionSemanticSchema>;

/** New runs only. The legacy resolver deliberately keeps missing fields missing. */
export function newMatchingPreferences(preferences?: CreativeAgentPreferences) {
  const resolved = resolveCreativeAgentPreferences(preferences);
  return { image: resolved.image ?? { mode: "auto" as const }, video: resolved.video ?? { mode: "auto" as const } };
}

/** Scalar normalization only; never selects a model or an execution route. */
function normalizedScalarText(text: string) {
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  return text.replace(/[零〇一二两三四五六七八九十百千]+/g, word => {
    if (!/[十百千]/.test(word)) return [...word].map(char => digits[char]).join("");
    let total = 0, digit = 0;
    for (const char of word) {
      if (char in digits) digit = digits[char];
      else { total += (digit || 1) * ({ 十: 10, 百: 100, 千: 1000 }[char] ?? 0); digit = 0; }
    }
    return String(total + digit);
  }).replace(/[：比]/g, ":").replace(/正方形|方形/g, "1:1").toLocaleLowerCase();
}

/** One denial grammar for a quantity subject, before or after that subject.
 * Parameter descriptions (不要水印 / 不用黑色背景) are not execution predicates.
 * Mixed/double-negative execution instructions remain conservative rejections.
 */
const quantityDenial = "(?:不(?:被允许|允许|可以|需要|要|许|用|能|可|准|得|必)?|禁止|无需|别|勿|莫|no\\b|never\\b|do\\s+not\\b|don't\\b|not\\b)";
function deniesQuantitySubject(before: string, after: string) {
  const execution = "(?:生成|制作|创建|产出|交付|输出|调用|重试|补试|执行)";
  const modifier = "(?:\\s|都|也|一律|全部|再|额外|继续|进行|去|被|先|暂时|请)";
  const modifiers = `${modifier}*`;
  // The same denial must govern an execution verb or the subject itself.
  // Bare permission denial (subject 是不被允许的) also governs that subject.
  const predicate = `${quantityDenial}${modifiers}(?:${execution}|(?:有|要)?(?:的|了)?\\s*$)`;
  const beforeDenied = new RegExp(predicate, "i").test(before);
  const afterDenied = new RegExp(`^(?:${modifier}|是|的|绝对)*${predicate}`, "i").test(after);
  return beforeDenied || afterDenied;
}

/** One subject span for every numeric field, including compound role/media
 * names. Only this span supplies an object and the suffix for denial checks.
 */
function quantitySubject(tail: string, staticVisualOutput = false) {
  const unit = /^(张|幅|份|个|版|段|条|outputs?\b|versions?\b|次|times?\b|calls?\b)\s*/i.exec(tail);
  if (!unit) return undefined;
  const call = /^(?:次|times?|calls?)/i.test(unit[1]);
  const remainder = tail.slice(unit[0].length);
  const image = "图片|图像|照片|海报|插画|卡片|封面|主图|图|画|images?" + (staticVisualOutput ? "|背景|场景" : "");
  const video = "视频|影片|短片|动画|videos?";
  const noun = `${image}|${video}|素材|产物|版本|成品|outputs?|versions?`;
  const execution = "生成|制作|创建|产出|交付|输出|调用|重试|补试|执行";
  const descriptive = new RegExp(`^(?:\\s+|的|[一-龥]{1,3}色|黑白|高清|横版|竖版|(?:(?!${execution}|${image}|${video})[^0-9的和及与+并（）()]){1,16}的)`, "i");
  let consumed = 0;
  const roles: string[] = [];
  if (!call) while (consumed < remainder.length) {
    const rest = remainder.slice(consumed);
    const role = /^(最终|成品|中间|参考)(?:的)?/.exec(rest);
    if (role) { roles.push(role[1]); consumed += role[0].length; continue; }
    if (new RegExp(`^(?:${noun})`, "i").test(rest)) break;
    const modifier = descriptive.exec(rest);
    if (modifier) { consumed += modifier[0].length; continue; }
    // Chinese compound noun modifiers need no 的 (e.g. material + subject +
    // media head). Require a complete media head, and never swallow execution,
    // negation, a quantity, or a semantic role into a descriptive span.
    const compound = new RegExp(`^((?:(?!${execution}|${quantityDenial}|构图|意图|企图|最终|成品|中间|参考|用于|用来|作为|涉及|关于|提到|提及|包含|包括|要求|说明|描述|针对|和|及|与|并)[一-龥]){1,48}?)(?=图片|图像|照片|海报|插画|卡片|封面|主图|视频|影片|短片|动画|${staticVisualOutput ? "背景|场景" : "(?!)"}|${/^(张|幅|个)$/.test(unit[1]) ? "图(?=$|的|是|，|。|！|；|\\s)" : "(?!)"})`, "i").exec(rest);
    if (!compound) break;
    consumed += compound[0].length;
  }
  const object = new RegExp(call ? "^(?:初次调用|首次调用|调用|重试|补试|initial calls?|calls?|retr(?:y|ies))" : `^(?:${noun})`, "i").exec(remainder.slice(consumed));
  // Bare count/role phrases are valid only at a boundary or before a denial
  // predicate/parameter constraint. An unknown noun (条要求/次方) is not media.
  const rest = remainder.slice(consumed);
  if (!object && rest.trim() && !new RegExp(`^${quantityDenial}`, "i").test(rest)) return undefined;
  const length = unit[0].length + consumed + (object?.[0].length ?? 0);
  const media = object ? new RegExp(`^(?:${image})$`, "i").test(object[0]) ? "image" : new RegExp(`^(?:${video})$`, "i").test(object[0]) ? "video" : undefined
    : /张|幅/.test(unit[1]) ? "image" : /段|条/.test(unit[1]) ? "video" : undefined;
  // Parameter modifiers are deliberately excluded from semantic roles.
  return { length, role: roles.join(" ") + (call ? object?.[0] ?? "" : ""), kind: call ? "call" : "output", media };
}

/** Scalar inputs need a user-visible quantity object, not only a hidden semantic tag. */
function visibleQuantityQuestionMatches(field: string, text: string) {
  if (!/(?:数量|次数|张数|条数|份数|调用数|重试数|多少|几[张幅份个次条段]|number|count|how many)/i.test(text) || /(?:时长|时间|秒|分钟|尺寸|像素|分辨率|金额|价格|tokens?|seconds?|duration|pixels?)/i.test(text)) return false;
  const image = /(?:图片|图像|照片|海报|插画|封面|images?)/i.test(text), video = /(?:视频|影片|短片|动画|videos?)/i.test(text);
  const intermediate = /(?:中间|参考|intermediate)/i.test(text), final = /(?:最终|成品|交付|final|deliver)/i.test(text), total = /(?:总共|总计|总量|总数|总生成|总调用|total)/i.test(text);
  const retry = /(?:重试|补试|retr(?:y|ies))/i.test(text), initial = /(?:初次|首次|initial)/i.test(text), call = retry || /(?:调用|calls?)/i.test(text);
  if (field === "image.quantity" || field === "video.quantity") return !call && !intermediate && !total && (field === "image.quantity" ? image && !video : video && !image);
  if (field === "generation.retryCalls") return retry && !initial && !total;
  if (field === "generation.initialCalls") return call && initial && !retry && !total;
  if (field === "generation.totalCalls") return call && total && !intermediate;
  const output = image || video || /(?:产物|成品|输出|outputs?)/i.test(text);
  if (field === "generation.finalOutputs") return output && final && !intermediate && !call && !total;
  if (field === "generation.intermediateOutputs") return output && intermediate && !final && !call && !total;
  return field === "generation.totalOutputs" && output && total && !call;
}

export type RequirementOptionEvidence = Record<string, { value: string; label: string }[]>;
export function validateRequirementEvidence(fact: RequirementFact, sources: RequirementEvidence[], optionEvidence: RequirementOptionEvidence = {}): RequirementFact {
  const options = optionEvidence[fact.field] ?? [];
  let canonicalValue = fact.value;
  let literalValue = fact.value;
  if (typeof fact.value === "string") {
    const direct = options.filter(option => option.label === fact.value || option.value === fact.value);
    if (new Set(direct.map(option => option.value)).size === 1) canonicalValue = direct[0].value;
    if (!fact.source.quote.toLocaleLowerCase().includes(String(canonicalValue).toLocaleLowerCase())) {
      // Longest labels prevent transparent matching inside opaque, or high inside extra-high.
      const labels = options.filter(option => fact.source.quote.includes(option.label)).sort((a,b) => b.label.length-a.label.length);
      const longest = labels.filter(option => option.label.length === labels[0]?.label.length);
      if (longest.length && (new Set(longest.map(option => option.value)).size !== 1 || longest[0].value !== canonicalValue)) throw new Error("选项标签与原文含义不唯一或不一致");
      if (longest[0]) literalValue = longest[0].label;
    }
  }
  const source = fact.source;
  const actual = sources.find(item => item.kind === source.kind && item.sourceId === source.sourceId && item.fieldId === source.fieldId && item.channel === source.channel);
  if (!actual) throw new Error("source.sourceId/kind/fieldId/channel 不匹配本轮用户原文或有效回答；核对本轮 messageId 或已保存 decisionId 与回答字段，不要使用 actionId");
  if (!actual.text.includes(source.quote)) throw new Error("source.quote 未逐字出现在该来源；从本轮原文或有效回答复制真实片段，不要改写或拼接");
  const start = source.start ?? actual.text.indexOf(source.quote);
  const end = source.end ?? start + source.quote.length;
  if (source.start === undefined && actual.text.indexOf(source.quote, start + 1) !== -1) throw new Error("source.start/end 缺失：同一句原文出现多次，请按 UTF-16 字符位置指定所需片段，start 含起点、end 不含终点");
  if (start < 0 || actual.text.slice(start, end) !== source.quote || end - start !== source.quote.length) throw new Error("source.start/end 与 source.quote 不匹配；唯一引用请同时省略 start/end，由服务端定位；重复引用须按 UTF-16 修正偏移，start 含起点、end 不含终点；已提供的错误偏移不会被忽略");
  const value = literalValue;
  let valueStart = start;
  const quantityFact = fact.field.startsWith("generation.") || fact.field.endsWith(".quantity");
  const zeroQuantity = value === 0 && quantityFact && !/(?:^|[^0-9])0(?:[^0-9]|$)/.test(normalizedScalarText(source.quote));
  const literal = zeroQuantity ? undefined : typeof value === "object" ? value.mode === "explicit" ? "model" in value ? value.model : value.unresolvedAlias : undefined : typeof value === "boolean" || fact.field === "intent" ? undefined : String(value);
  // A broad quote may contain the same numeral for unrelated attributes. Keep
  // its provenance, but bind only one independently valid quantity occurrence.
  if (quantityFact && typeof value === "number" && value !== 0) {
    const candidates = [...source.quote.matchAll(/[0-9]+(?:\.[0-9]+)?|[零〇一二两三四五六七八九十百千]+/g)].filter(match => Number(normalizedScalarText(match[0])) === value);
    if (candidates.length > 1) {
      const valid: RequirementFact[] = [];
      let fieldError: Error | undefined;
      const quoteContext = actual.text.replace(/(?<=[a-zA-Z0-9])['’](?=[a-zA-Z0-9])/g, " ");
      const quoted = [...quoteContext.matchAll(/```[\s\S]*?(?:```|$)|`[^`\n]*(?:`|$)|“[^”]*(?:”|$)|‘[^’]*(?:’|$)|「[^」]*(?:」|$)|『[^』]*(?:』|$)|"[^"]*(?:"|$)|'[^']*(?:'|$)|^[ \t]*>[^\n]*$/gm)];
      for (const candidate of candidates) {
        const offset = start + candidate.index!;
        if (quoted.some(range => offset >= range.index! && offset < range.index! + range[0].length)) continue;
        const prefix = actual.text.slice(0, offset).split(/[，,。.!！？?;；\n]/).at(-1) ?? "";
        const tail = actual.text.slice(offset + candidate[0].length).trimStart().split(/[，,。.!！？?;；\n]/)[0];
        const subject = quantitySubject(tail);
        if (subject && /^(?:中的|之中|当中|里的|之一|中(?=选|挑|取))/.test(tail.slice(subject.length))
          || /(?:包含|含有|包括|内含|由)[^，,。.!！？?;；\n]*$/.test(prefix)) continue;
        try {
          valid.push(validateRequirementEvidence({ ...fact, source: { ...source, quote: candidate[0], start: offset, end: offset + candidate[0].length } }, sources, optionEvidence));
        } catch (error) {
          if (error instanceof Error && error.message.includes("generation.totalOutputs")) fieldError = error;
        }
      }
      if (valid.length > 1) throw new Error("source.quote 包含多个有效同值数量，无法唯一绑定；请缩小引用到该字段对应的真实数量片段");
      if (valid.length === 1) return { ...valid[0], source: { ...valid[0].source, quote: source.quote, start, end } };
      throw fieldError ?? new Error("数量来源未明确授权该类产物或调用；请引用唯一有效的数量片段");
    }
  }
  const quote = normalizedScalarText(source.quote);
  if (literal) {
    const expected = typeof value === "object" ? literal.toLocaleLowerCase() : normalizedScalarText(literal);
    const evidence = typeof value === "object" ? source.quote.toLocaleLowerCase() : quote;
    const position = evidence.indexOf(expected);
    const before = position === 0 ? actual.text[start - 1] ?? "" : evidence[position - 1] ?? "";
    const after = position + expected.length === evidence.length ? actual.text[end] ?? "" : evidence[position + expected.length] ?? "";
    if (position < 0 || /[a-zA-Z0-9_.:-]/.test(before) || /[a-zA-Z0-9_.:-]/.test(after)) throw new Error("value 未以完整字段出现在 source.quote 中；组合数量须分项记录各自原文值，由服务端求和，不能把推算总数当 literal fact；保留旧参数须用 continuation，不要把继承值另写为 facts");
    // Anchor meaning to the value in the trusted text, not the LLM's quote boundary.
    const normalize = typeof value === "object" ? (text: string) => text.toLocaleLowerCase() : normalizedScalarText;
    for (let offset = 0; offset <= source.quote.length; offset++) {
      if (normalize(source.quote.slice(0, offset)).length > position) break;
      valueStart = start + offset;
    }
    if (typeof literalValue === "string" && options.some(option => {
      const offset = option.label.indexOf(literalValue);
      return offset >= 0 && option.label.length > literalValue.length && actual.text.slice(valueStart - offset, valueStart - offset + option.label.length) === option.label;
    })) throw new Error("不能从更长的选项标签中截取相反含义");
    const prefix = normalizedScalarText(actual.text.slice(Math.max(0, start - 24), start)) + evidence.slice(0, position);
    if (!quantityFact && /(?:不要用|不要|不用|禁止|不能|不是|不使用|别用|without|no|not|never|don['’]t\s+use)\s*$/i.test(prefix)) throw new Error("否定要求不能转换成肯定覆盖");
  }
  // Only the store can supply this identity after validating the durable question
  // and answer. Free text, notes and approval revisions keep the full grammar.
  const typed = actual.typedAnswer;
  const scalarQuantityAnswer = quantityFact && actual.kind === "answer" && actual.channel === "values" && typed?.requirement === fact.field
    && actual.text === String(typed.value) && source.quote === actual.text && start === 0 && end === actual.text.length
    && (typed.type === "number" && typeof typed.value === "number" || (typed.type === "radio" || typed.type === "select") && typeof typed.value === "string" && /^\d+$/.test(typed.value))
    && Number(typed.value) === value;
  if (scalarQuantityAnswer) {
    if (!visibleQuantityQuestionMatches(fact.field, `${typed.title} ${typed.description ?? ""} ${typed.singleQuestion ?? ""}`)) throw new Error("数字问题的可见说明未明确对应数量对象，不能提供生成授权");
    if (typed.type !== "number") {
      const label = typed.choiceLabel;
      if (!label) throw new Error("数量选项缺少可核验的显示标签");
      if (normalizedScalarText(label.trim()) !== String(value)) {
        // This is the actual saved label the user selected, not a synthesized
        // user sentence. Validate it separately; persist the original value quote.
        validateRequirementEvidence({ ...fact, source: { ...source, quote: label, start: 0, end: label.length } }, [{ ...actual, text: label, typedAnswer: undefined }]);
      }
    }
  }
  if (quantityFact && !scalarQuantityAnswer) {
    // The quote locates evidence; it must not remove negation or the object from
    // the trusted sentence. A number belongs to its own media/count clause.
    const separators = /[，,。.!！?？;；\n]/;
    let clauseStart = valueStart, clauseEnd = valueStart;
    while (clauseStart > 0 && !separators.test(actual.text[clauseStart - 1])) clauseStart--;
    while (clauseEnd < actual.text.length && !separators.test(actual.text[clauseEnd])) clauseEnd++;
    const prefix = actual.text.slice(clauseStart, valueStart).toLocaleLowerCase();
    const syntaxText = actual.text.slice(clauseStart, clauseEnd).toLocaleLowerCase();
    const number = String(value);
    const rawQuantity = actual.text.slice(valueStart, clauseEnd).toLocaleLowerCase();
    const numericPrefix = new RegExp(`^(?:${number}|[零〇一二两三四五六七八九十百]+)\\s*`);
    const tail = rawQuantity.replace(numericPrefix, "");
    const objectTail = tail.split(/[0-9和及与+并（）()]/)[0];
    const subject = quantitySubject(objectTail, /(?:生成|升成|制作|创建|产出|绘制|画|需要|想要)\s*$/.test(prefix));
    if (!zeroQuantity && (!subject || deniesQuantitySubject(prefix, tail.slice(subject.length)))) throw new Error("数量对象不明确或已被否定，不能提供生成授权");
    const deniesObject = (term: string) => [...syntaxText.matchAll(new RegExp(term, "gi"))].some(match =>
      deniesQuantitySubject(syntaxText.slice(0, match.index).replace(/[0-9零〇一二两三四五六七八九十百]+\s*(?:张|幅|份|个|段|条|次)?\s*$/, ""), syntaxText.slice(match.index! + match[0].length)));
    const qualifiers = "(?:\\s|的|为|是|需要|要求|生成|制作|创建|产出|交付|输出|调用|重试|补试|只能|可以|允许|最多|至少|只要|要|共|仅|只|上限|：|:)*";
    const before = (term: string) => new RegExp(`(?:${term})${qualifiers}$`, "i").test(prefix);
    const ownRole = (kind: "output" | "call", term: string) => subject?.kind === kind && (before(term) || new RegExp(term, "i").test(subject.role));
    let supported = false;
    if (fact.field === "generation.finalOutputs") {
      const intermediate = ownRole("output", "中间|参考(?:图片|图|素材)?|intermediate");
      const total = before("总共|总计|总量|一共|合计|总生成|total|只生成|仅生成|最多生成");
      const ordinaryMedia = subject?.kind === "output" && subject.media !== undefined && !subject.role
        && !/最终|成品|中间|参考|final|intermediate/i.test(objectTail.slice(0, subject.length));
      supported = ownRole("output", "最终|成品|交付|final|deliver") || !intermediate && !total && ordinaryMedia;
    }
    else if (fact.field === "generation.intermediateOutputs") supported = zeroQuantity ? deniesObject("参考图片|参考图|参考素材|中间|intermediate") : ownRole("output", "中间|参考|intermediate");
    else if (fact.field === "generation.retryCalls") supported = zeroQuantity ? deniesObject("重试|补试|retr(?:y|ies)") : ownRole("call", "重试|补试|retr(?:y|ies)");
    else if (fact.field === "generation.initialCalls") supported = ownRole("call", "初次(?:调用)?|首次(?:调用)?|调用|initial(?: calls?)?|calls?");
    else if (fact.field === "generation.totalCalls") supported = ownRole("call", "调用|calls?") && before("总共|总计|一共|最多|上限|total|at most");
    else if (fact.field === "generation.totalOutputs") supported = subject?.kind === "output" && before("总共|总计|总量|一共|合计|总生成|total|只生成|仅生成|最多生成");
    else supported = subject?.kind === "output" && subject.media === (fact.field === "image.quantity" ? "image" : "video");
    if (!supported && fact.field === "generation.finalOutputs" && subject?.kind === "output" && before("总共|总计|总量|一共|合计|总生成|total|只生成|仅生成|最多生成")) throw new Error("数量来源未明确授权该类产物或调用：该片段是总生成上限，请使用 generation.totalOutputs；不能记为 generation.finalOutputs。若 image.quantity/video.quantity 与 generation.totalOutputs 已完整表达原文数量，无需额外填 generation.finalOutputs；原文明确的最终产物约束仍须保留");
    if (!supported) throw new Error("数量来源未明确授权该类产物或调用");
  }
  if (typeof value === "boolean") {
    const context = actual.text.slice(Math.max(0, start - 12), end);
    const negative = /false|无声|静音|(?:不需要|不要|不生成|关闭|禁用)(?:声音|音频)|no\s+audio|without\s+(?:sound|audio)|(?:not|不要|不用)\s*true/i.test(context);
    const positive = /true|有声|(?:需要|生成|开启|启用)(?:声音|音频)|with\s+(?:sound|audio)/i.test(source.quote);
    if (value ? !positive || negative : !negative) throw new Error("音频开关与用户原文不符，不能反转明确否定");
  }
  if (typeof value === "object" && value.mode === "auto") {
    const delegation = /(?:自动|智能匹配|你(?:来)?(?:决定|选|按能力匹配)|随便|auto|you\s+(?:choose|decide))/i.exec(source.quote);
    const prefix = delegation ? actual.text.slice(Math.max(0, start + delegation.index - 24), start + delegation.index) : "";
    const offset = start + (delegation?.index ?? 0);
    // Apostrophes inside ordinary English words are not quotation delimiters.
    const quoteContext = actual.text.replace(/(?<=[a-zA-Z0-9])['’](?=[a-zA-Z0-9])/g, " ");
    const quoted = [['“','”'],['‘','’'],['「','」'],['『','』'],['"','"'],["'","'"],['`','`']].some(([open,close]) => {
      const before = quoteContext.slice(0, offset), opening = before.lastIndexOf(open);
      return opening >= 0 && (open === close ? before.split(open).length % 2 === 0 : before.lastIndexOf(close) < opening) && quoteContext.indexOf(close, offset) >= 0;
    });
    if (!delegation || quoted || /(?:不要|不用|禁止|别|不|not|never|don['’]t)[^，,。.!！?？;；\n]{0,16}$/i.test(prefix)) throw new Error("原文没有明确委托自动选择");
  }
  const correction = source.kind === "message" && /(?:改为|改成|更正为|换成|instead(?:\s+use)?|change\s+to)\s*$/i.test(actual.text.slice(Math.max(0, valueStart - 24), valueStart));
  return requirementFactSchema.parse({ ...fact, value: canonicalValue, source: { ...source, start, end, valueStart, order: actual.order ?? 0, correction, ...(quantityFact ? { quantityEvidenceVersion: 2 } : {}) } });
}

export function activeFieldFacts(facts: RequirementFact[], field: string) {
  let relevant = facts.filter(fact => fact.field === field);
  const answers = relevant.filter(fact => fact.source.kind === "answer");
  if (answers.length) {
    const latestSource = [...answers].sort((a, b) => (b.source.order ?? 0) - (a.source.order ?? 0) || b.source.sourceId.localeCompare(a.source.sourceId))[0].source.sourceId;
    relevant = answers.filter(fact => fact.source.sourceId === latestSource);
  } else {
    const position = (fact: RequirementFact) => fact.source.valueStart ?? fact.source.start ?? 0;
    const corrected = relevant.filter(fact => fact.source.correction).sort((a, b) => position(b) - position(a))[0];
    if (corrected) relevant = relevant.filter(fact => position(fact) >= position(corrected));
  }
  return relevant;
}
/** Version 2 proves full trusted-source validation with the shared subject
 * parser. Older versions (including apparently complete quotes) are lossy;
 * without the actual message/answer they cannot authorize a fresh dispatch.
 */
export function assertQuantitySourceSemantics(facts: RequirementFact[]) {
  for (const field of requirementFields.filter(field => field.startsWith("generation.") || field.endsWith(".quantity"))) {
    for (const fact of activeFieldFacts(facts, field).filter(fact => fact.strength === "hard")) {
      if (fact.source.quantityEvidenceVersion !== 2) throw new Error("历史数量来源需要完整可信原文重新核对，引用片段不能补证");
    }
  }
}
/** Only independent trusted numeric occurrences can fund additive output buckets. */
export function assertIndependentOutputQuantitySources(facts: RequirementFact[]) {
  const hard = (field: string) => activeFieldFacts(facts, field).filter(fact => fact.strength === "hard");
  const finals = hard("generation.finalOutputs");
  // An explicit final quantity replaces image/video quantities; those are not added.
  const groups = (finals.length ? [finals] : [hard("image.quantity"), hard("video.quantity")])
    .concat([hard("generation.intermediateOutputs")])
    .map(group => group.filter(fact => typeof fact.value === "number" && fact.value > 0));
  const origin = (source: RequirementFact["source"]) => JSON.stringify([source.kind, source.sourceId, source.fieldId, source.channel]);
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) {
    for (const left of groups[i]) for (const right of groups[j]) {
      if (origin(left.source) !== origin(right.source)) continue;
      if (left.source.valueStart === undefined || right.source.valueStart === undefined || left.source.valueStart === right.source.valueStart) {
        throw new Error("可相加的最终和中间产物或图片和视频数量必须有独立的用户数量来源");
      }
    }
  }
}
const fieldMeaning = (facts: RequirementFact[]) => JSON.stringify([...new Set(facts.map(fact => JSON.stringify({ value: fact.value, strength: fact.strength })))].sort());

/** Add only distinct media subjects explicitly joined in the same trusted text.
 * The derived total is not a fabricated literal fact and is never accepted as tool input.
 */
const quantityEvidenceKey = (fact: RequirementFact) => JSON.stringify([fact.field, fact.value, fact.strength, fact.source.kind, fact.source.sourceId, fact.source.fieldId, fact.source.channel, fact.source.valueStart, fact.source.quantityEvidenceVersion]);
function composeQuantity(facts: RequirementFact[], sources: RequirementEvidence[]) {
  if (facts.length < 2 || facts.some(fact => typeof fact.value !== "number" || fact.value <= 0)) return undefined;
  const origin = (fact: RequirementFact) => JSON.stringify([fact.source.kind, fact.source.sourceId, fact.source.fieldId, fact.source.channel]);
  if (new Set(facts.map(origin)).size !== 1) return undefined;
  const source = sources.find(item => origin(facts[0]) === JSON.stringify([item.kind, item.sourceId, item.fieldId, item.channel]));
  if (!source) return undefined;
  const unique = [...new Map(facts.map(fact => [fact.source.valueStart, fact])).values()].sort((a,b) => a.source.valueStart! - b.source.valueStart!);
  if (unique.length < 2 || unique.some(fact => fact.source.valueStart === undefined)) return undefined;
  let commaList = false;
  const subjects: string[] = [];
  for (let index = 0; index < unique.length - 1; index++) {
    const between = source.text.slice(unique[index].source.valueStart!, unique[index + 1].source.valueStart!);
    const tail = between.replace(/^(?:[0-9]+|[零〇一二两三四五六七八九十百]+)\s*/, "");
    const subject = quantitySubject(tail.split(/[，,和及与+并（）()]/)[0]);
    if (!subject) return undefined;
    const join = tail.slice(subject.length);
    if (/^\s*[，,]\s*$/.test(join)) commaList = true;
    else if (!/^(?:\s|，|,)*(?:和|以及|及|与|\+|and)\s*$/i.test(join)) return undefined;
    subjects.push(tail.slice(0,subject.length).trim());
  }
  const value = unique.reduce((sum, fact) => sum + Number(fact.value), 0);
  if (commaList) {
    // A comma alone is not additive authority: require a matching explicit
    // media total followed by a colon and distinct enumerated subjects.
    const header = source.text.slice(0,unique[0].source.valueStart).split(/[，,。.!！?？;；\n]/).at(-1) ?? "";
    const total = /^\s*(?:请)?(?:生成|制作|做|需要|要)\s*([0-9零〇一二两三四五六七八九十百]+)\s*(张|幅|条|段)\s*([一-龥]{0,20})[：:]\s*$/.exec(header);
    const noun = facts[0].field === "image.quantity" ? /(?:图片|图像|照片|海报|插画|卡片|封面|图|画)$/ : /(?:视频|影片|短片|动画)$/;
    const last = source.text.slice(unique.at(-1)!.source.valueStart!).replace(/^(?:[0-9]+|[零〇一二两三四五六七八九十百]+)\s*/, "").split(/[，,。.!！?？;；\n]/)[0];
    const subject = quantitySubject(last);
    if (!total || Number(normalizedScalarText(total[1])) !== value || !noun.test(total[3]) || /或|不|别|禁止|无需|勿|除|零|〇|一|二|两|三|四|五|六|七|八|九|十|百/.test(total[3]) || !subject) return undefined;
    if (facts[0].field === "image.quantity" ? !/[张幅]/.test(total[2]) : !/[条段]/.test(total[2])) return undefined;
    subjects.push(last.slice(0,subject.length).trim());
    const identities = subjects.map(subject => subject.replace(/^(?:张|幅|条|段)\s*/, "").replace(/(?:图片|图像|照片|海报|插画|卡片|封面|图|画|视频|影片|短片|动画)$/, "").trim());
    if (new Set(identities).size !== unique.length) return undefined;
  }
  return { value, evidence: facts.map(quantityEvidenceKey).sort() };
}
/** A completeness check only: these temporary evidence candidates never grant or persist authority. */
export function explicitMediaOutputQuantity(text: string, mediaType: "image" | "video") {
  if (/(?:最多|至多|至少|上限|不超过|任选|或者|或|\bat most\b|\bat least\b|\bup to\b|\bor\b)/i.test(text)) return undefined;
  const facts: RequirementFact[] = [];
  const evidence: RequirementEvidence = { kind: "message", sourceId: "current-request", text };
  for (const match of text.matchAll(/[0-9零〇一二两三四五六七八九十百千]+(?=\s*(?:张|幅|份|个|条|段))/g)) {
    const value = Number(normalizedScalarText(match[0]));
    const prefix = text.slice(0, match.index);
    const tail = text.slice(match.index! + match[0].length).trimStart();
    const subject = quantitySubject(tail, /(?:生成|升成|制作|创建|产出|绘制|画|需要|想要)\s*$/.test(prefix));
    if (!Number.isSafeInteger(value) || value < 1 || subject?.kind !== "output" || subject.media !== mediaType || /中间|参考/.test(subject.role) || /(?:中间|参考)\s*$/.test(prefix)) continue;
    // A containing set or an element inside another output is not a delivery count.
    if (/^(?:中的|之中|当中|里的|之一|中(?=选|挑|取))/.test(tail.slice(subject.length))
      || /(?:包含|含有|包括|内含|由)[^，,。.!！？?;；\n]*$/.test(prefix)) continue;
    try {
      facts.push(validateRequirementEvidence({ field: `${mediaType}.quantity`, value, strength: "hard", source: { kind: "message", sourceId: evidence.sourceId, quote: match[0], start: match.index!, end: match.index! + match[0].length } }, [evidence]));
    } catch { /* Unsupported quantity semantics are not inferred. */ }
  }
  if (!facts.length) return undefined;
  return composeQuantity(facts, [evidence])?.value ?? Math.max(...facts.map(fact => Number(fact.value)));
}
export function composedQuantity(state: Pick<TurnRequirements, "facts" | "composedQuantities"> | undefined, field: string) {
  const derived = state?.composedQuantities?.[field];
  const facts = activeFieldFacts(state?.facts ?? [], field).filter(fact => fact.strength === "hard");
  return derived && JSON.stringify(derived.evidence) === JSON.stringify(facts.map(quantityEvidenceKey).sort()) ? derived.value : undefined;
}

export function mergeTurnRequirements(preferences: CreativeAgentPreferences | undefined, previous: TurnRequirements | undefined, input: unknown, sources: RequirementEvidence[], optionEvidence: RequirementOptionEvidence = {}): TurnRequirements {
  const facts: RequirementFact[] = [];
  const errors: string[] = [];
  turnRequirementsSchema.parse(input).facts.forEach((fact, index) => {
    try { facts.push(validateRequirementEvidence(fact, sources, optionEvidence)); }
    catch (error) { errors.push(`facts[${index}] (${fact.field}): ${error instanceof Error ? error.message : "需求来源校验失败"}`); }
  });
  if (errors.length) throw new Error(errors.join("\n"));
  const priorFacts = (previous?.facts ?? []).map(fact => requirementFactSchema.parse(fact));
  const merged = [...priorFacts];
  const fieldRevisions = { ...previous?.fieldRevisions };
  const changedFields = new Set<string>();
  for (const fact of facts) if (!merged.some(item => JSON.stringify(item) === JSON.stringify(fact))) {
    merged.push(fact);
  }
  // Upgrade active old facts only when their full trusted source is present.
  // Never reconstruct that source from a quote, regardless of apparent syntax.
  for (const field of requirementFields.filter(field => field.startsWith("generation.") || field.endsWith(".quantity"))) {
    for (const fact of activeFieldFacts(merged, field).filter(fact => fact.strength === "hard" && fact.source.quantityEvidenceVersion !== 2)) {
      const index = merged.indexOf(fact);
      const validated = validateRequirementEvidence(fact, sources, optionEvidence);
      if (fact.source.valueStart !== undefined && fact.source.valueStart !== validated.source.valueStart) throw new Error("历史数量来源不能重新绑定到另一个数值");
      merged[index] = validated;
    }
  }
  assertQuantitySourceSemantics(merged);
  assertIndependentOutputQuantitySources(merged);
  const effectivePreferences = newMatchingPreferences(preferences);
  if (previous?.continuation?.targets.length === 1) {
    const target = previous.continuation.targets[0];
    effectivePreferences[target.mediaType] = { ...effectivePreferences[target.mediaType], params: { ...effectivePreferences[target.mediaType].params, ...target.params } };
  }
  const conflicts: string[] = [];
  const composedQuantities: NonNullable<TurnRequirements["composedQuantities"]> = {};
  for (const field of requirementFields) {
    const relevant = activeFieldFacts(merged, field);
    if (fieldMeaning(relevant) !== fieldMeaning(activeFieldFacts(priorFacts, field))) {
      changedFields.add(field);
      fieldRevisions[field] = (previous?.revision ?? 0) + 1;
    }
    const hard = relevant.filter(fact => fact.strength === "hard");
    if (!hard.length) continue;
    if (field === "image.quantity" || field === "video.quantity") {
      const derived = composeQuantity(hard, sources) ?? (composedQuantity({facts:merged,composedQuantities:previous?.composedQuantities}, field) !== undefined ? previous?.composedQuantities?.[field] : undefined);
      if (derived) {
        composedQuantities[field] = derived;
        const prior = composedQuantity(previous,field) ?? activeFieldFacts(priorFacts,field).find(fact => fact.strength === "hard")?.value;
        if (prior !== derived.value) { changedFields.add(field); fieldRevisions[field]=(previous?.revision ?? 0)+1; }
        continue;
      }
    }
    if (new Set(hard.map(fact => JSON.stringify(fact.value))).size > 1) { conflicts.push(field); continue; }
    const value = hard[0].value;
    const [media, section, parameter] = field.split(".");
    if (media !== "image" && media !== "video") continue;
    if (section === "modelChoice") {
      const choice = modelChoiceSchema.parse(value);
      effectivePreferences[media] = { ...choice, ...(effectivePreferences[media].params ? { params: effectivePreferences[media].params } : {}) };
    } else if (section === "params") {
      effectivePreferences[media] = { ...effectivePreferences[media], params: { ...effectivePreferences[media].params, [parameter]: value } };
    }
  }
  return { version: 1, fieldRevisions, ...(previous?.continuation ? {continuation:previous.continuation} : {}), composedQuantities, unavailable: previous?.unavailable?.filter(field => ![...changedFields].some(changed => changed.split(".")[0] === field.split(".")[0])), revision: (previous?.revision ?? 0) + (changedFields.size ? 1 : 0), facts: merged, conflicts, effectivePreferences };
}

export function filterSemanticQuestions<T extends { semantic?: unknown }>(fields: T[], preferences: ReturnType<typeof newMatchingPreferences>, state: Pick<TurnRequirements, "revision" | "conflicts"> & Partial<Pick<TurnRequirements, "facts" | "fieldRevisions" | "unavailable">>, asked: QuestionSemantic[]): T[] {
  return fields.filter(field => {
    const semantic = questionSemanticSchema.parse(field.semantic);
    if (semantic.revision !== state.revision) throw new Error("问题的需求版本已变化，请读取本轮有效需求");
    const fieldRevision = state.fieldRevisions ? state.fieldRevisions[semantic.requirement] ?? 0 : state.revision;
    if (asked.some(item => item.revision >= fieldRevision && (item.unresolvedId === semantic.unresolvedId || item.requirement === semantic.requirement && item.purpose === semantic.purpose))) return false;
    if (semantic.purpose === "hard_conflict") return state.conflicts.includes(semantic.requirement);
    if (semantic.purpose === "unavailable_requirement") return state.unavailable?.some(item => requirementContains(item, semantic.requirement)) === true;
    if (semantic.requirement.endsWith(".modelChoice")) return false;
    if (semantic.purpose !== "missing_input") return true;
    const [media, section, parameter] = semantic.requirement.split(".");
    if (media !== "image" && media !== "video") return true;
    if (section === "modelChoice") return false;
    if (section === "params" && parameter && !state.conflicts.includes(semantic.requirement)) return (preferences[media].params as Record<string, unknown> | undefined)?.[parameter] === undefined;
    const known = state as Pick<TurnRequirements, "revision" | "conflicts"> & { facts?: RequirementFact[] };
    return !known.facts?.some(fact => fact.field === semantic.requirement) || state.conflicts.includes(semantic.requirement);
  });
}
