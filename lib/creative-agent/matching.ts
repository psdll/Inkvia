import "server-only";
import { hashCanvasMutationPayload } from "@/lib/canvas/mutation-contract";
import { TOOLBOX_MODEL_DEFINITIONS } from "@/lib/toolbox-models";
import { getKieVideoApiModel, getVideoModelSpec, isKieVideoModel } from "@/lib/sora2";
import { imageProviderSnapshotModel, imageProviderRequestContract } from "@/lib/generation/image-route-identity";
import { isMidjourneyV8Model, MIDJOURNEY_V8_OUTPUT_COUNT } from "@/lib/midjourney-v8";
import { isWanVideoModel } from "@/lib/wan-models";
import { isMiniMaxH3VideoModel } from "@/lib/minimax-models";
import { mapSeedreamModelId } from "@/lib/image-edit-helpers";
import { normalizeCreativeMediaRequest, type MediaCatalog, type ResolvedReference } from "./media-capabilities";
import { creativeContinuationPreference, type CreativeAgentPreferences } from "./preferences";
import { activeFieldFacts, type TurnRequirements } from "./matching-contracts";
import { CreativeAgentError } from "./errors";

export type OutputContract = { calls: number; minReturned: number; expectedReturned?: number; maxReturned?: number; exactReturned?: number; basis: string };
export type SelectionReceipt = {
  version: 1; id: string; requirementsRevision: number; mediaType: "image" | "video";
  catalogFingerprint: string;
  selectionPolicy: { task?: string; priorities: CapabilityEvidence["metric"][]; outputConstraint?: MatchingInput["outputConstraint"] };
  comparativeEvidenceIds: string[];
  route: { publicModelId: string; providerId: string; adapterId: string; providerModel: string; operation: string; variant: Record<string, unknown>; configFingerprint: string };
  request: { model: string; prompt: string; params: Record<string, unknown>; references: Record<string, unknown>[] };
  referenceVersions: { nodeId: string; contentVersion: string }[];
  output: OutputContract;
  reasons: string[]; evidenceLimits: string[];
};
export type MatchingExclusion = { modelId?: string; code: string; message: string; requirementFields?: string[] };
/** Comparative evidence is optional. Only same-cohort measurements covering the request are comparable. */
export type CapabilityEvidence = {
  version: 1; id: string; modelId: string; providerId: string; task: string;
  metric: "quality" | "speed" | "consistency"; value: number; higherIsBetter: boolean;
  sampleCount: number; measuredAt: string; expiresAt: string; source: string; cohort: string;
  params: Record<string, unknown>; referenceKinds: string[];
};
export type MatchingInput = {
  mediaType: "image" | "video"; request: Record<string, unknown>; references: ResolvedReference[];
  catalog: MediaCatalog & { fingerprint?: string; unavailable?: { id: string; mediaType: string; reasons: string[] }[] };
  preferences?: CreativeAgentPreferences; requirements?: TurnRequirements;
  outputConstraint?: { exact?: number; max?: number }; task?: string; priorities?: CapabilityEvidence["metric"][];
  evidence?: CapabilityEvidence[]; now?: string;
};
export type MediaMatchingContext = { policyVersion: 2; execution?: import("./quantity").GenerationExecution; preferences?: CreativeAgentPreferences; requirements?: TurnRequirements; receipt?: SelectionReceipt; task?: string; priorities?: CapabilityEvidence["metric"][]; outputConstraint?: MatchingInput["outputConstraint"] };
export type MatchingResult = { selected?: SelectionReceipt; exclusions: MatchingExclusion[]; alternatives: { modelId: string; reasons: string[] }[]; evidenceLimits: string[] };

function identity(reference: ResolvedReference) {
  const { kind: _kind, url: _url, facts: _facts, ...binding } = reference;
  return binding;
}
function outputContract(model: string, calls: number, mediaType: "image" | "video", params: Record<string, unknown>): OutputContract {
  if (isMidjourneyV8Model(model)) return { calls, minReturned: MIDJOURNEY_V8_OUTPUT_COUNT * calls, maxReturned: MIDJOURNEY_V8_OUTPUT_COUNT * calls, exactReturned: MIDJOURNEY_V8_OUTPUT_COUNT * calls, basis: "MIDJOURNEY_V8_OUTPUT_COUNT" };
  // Exact existing operations: Wan video_count=1; MiniMax V2 VideoTaskContent has a single video URL.
  // https://help.aliyun.com/zh/model-studio/wan3-video-generation-api-reference
  // https://platform.minimax.io/docs/api-reference/video-generation-v2-query
  if (mediaType === "video" && (isWanVideoModel(model) || isMiniMaxH3VideoModel(model))) return { calls, minReturned: 0, expectedReturned: calls, maxReturned: calls, basis: "provider_single_video_operation" };
  const contract = mediaType === "image" ? imageProviderRequestContract({ model, ...params }) : undefined;
  if (contract?.maxOutputCount !== undefined) return { calls, minReturned: 0, maxReturned: contract.maxOutputCount * calls, basis: contract.outputBasis! };
  if (contract?.declaredOutputCount !== undefined) return { calls, minReturned: 0, maxReturned: contract.declaredOutputCount * calls, expectedReturned: contract.declaredOutputCount * calls, basis: contract.outputBasis ?? "provider_request_n" };
  // n=1 is a requested call count, not proof of the provider's actual returned-file upper bound.
  return { calls, minReturned: 0, expectedReturned: calls, basis: "returned_file_upper_bound_unverified" };
}
function routeFor(mediaType: "image" | "video", model: MediaCatalog["image"][number] | MediaCatalog["video"][number], params: Record<string, unknown>, referenceCount: number) {
  const adapter = TOOLBOX_MODEL_DEFINITIONS.find(item => item.category === mediaType && item.id === model.id);
  if (!adapter || !model.qualification?.available) throw new CreativeAgentError("ADAPTER_UNSUPPORTED", "没有当前可执行的适配器资格合同", 400);
  const spec = mediaType === "video" ? getVideoModelSpec(model.id) : undefined;
  const providerModel = mediaType === "video" ? isKieVideoModel(model.id) ? getKieVideoApiModel(model.id) : spec?.upstreamModelId ?? model.id
    : adapter.provider === "volcengine" ? mapSeedreamModelId(model.id) : imageProviderSnapshotModel({ model: model.id, referenceCount, ...params });
  return { publicModelId: model.id, providerId: adapter.provider, adapterId: adapter.id, providerModel, operation: mediaType === "image" ? referenceCount ? "image_edit" : "text_to_image" : String(params.inputMode), variant: { ...params }, configFingerprint: model.qualification.routeConfigFingerprint };
}
export function mediaCatalogFingerprint(catalog: MatchingInput["catalog"]) {
  // Deliberately select capability fields; unrelated runtime settings cannot influence selection.
  return hashCanvasMutationPayload({ image: catalog.image.map(({ id, params, qualification, aliases, variants }) => ({ id, params, qualification, aliases, variants })).sort((a,b) => a.id.localeCompare(b.id)), video: catalog.video.map(({ id, supportedInputModes, supportedResolutions, supportedRatios, minDurationSeconds, maxDurationSeconds, durationOptions, allowAutoDuration, supportsGenerateAudio, supportedOutputFormats, supportedOmniReferenceTaskTypes, referenceLimits, qualification, aliases, variants }) => ({ id, supportedInputModes, supportedResolutions, supportedRatios, minDurationSeconds, maxDurationSeconds, durationOptions, allowAutoDuration, supportsGenerateAudio, supportedOutputFormats, supportedOmniReferenceTaskTypes, referenceLimits, qualification, aliases, variants })).sort((a,b) => a.id.localeCompare(b.id)), unavailable: catalog.unavailable });
}

export function matchMediaCandidates(input: MatchingInput): MatchingResult {
  const exclusions: MatchingExclusion[] = [];
  const evidenceLimits = ["配置就绪不代表已实测上游权限。", "没有当前同条件可比证据时，质量、速度和一致性未知；相同适配使用稳定模型ID排序。", "调用次数与实际返回文件数分别统计；全局数量预留由执行阶段负责。"];
  const result: MatchingResult = { exclusions, alternatives: [], evidenceLimits };
  const preference = creativeContinuationPreference((input.requirements?.effectivePreferences ?? input.preferences)?.[input.mediaType], input.requirements, input.mediaType, input.request.references);
  const continuation = input.requirements?.continuation;
  if (continuation) {
    const targets = continuation.targets.filter(target => target.mediaType === input.mediaType && input.references.some(ref => ref.nodeId === target.reference.nodeId && ref.semanticHash === target.reference.semanticHash && ref.batchId === target.reference.batchId && ref.outputId === target.reference.outputId && ref.facts?.contentVersion === target.contentVersion));
    if (!targets.length || new Set(targets.map(target => hashCanvasMutationPayload(target.params))).size > 1) {
      exclusions.push({code:"CONTINUATION_INVALID", message:"请分别绑定本次要修改的真实结果，保留各自设置。", requirementFields:["target.output"]}); return result;
    }
  }
  const candidates = input.catalog[input.mediaType];
  const explicit = preference?.mode === "explicit" ? preference.model || preference.unresolvedAlias : undefined;
  const exactMatches = explicit ? candidates.filter(model => model.id === explicit || model.label === explicit || model.aliases?.includes(explicit) || model.variants?.some(variant => variant.selectionId === explicit || variant.label === explicit)) : candidates;
  if (explicit && exactMatches.length !== 1) {
    const unavailable = input.catalog.unavailable?.find(item => item.id === explicit && item.mediaType === input.mediaType);
    exclusions.push({ modelId: explicit, code: unavailable ? "MEDIA_MODEL_UNAVAILABLE" : "MODEL_ALIAS_UNRESOLVED", requirementFields: [`${input.mediaType}.modelChoice`], message: unavailable ? unavailable.reasons.join(", ") : "指定模型ID或维护的名称不能唯一对应当前目录" });
    return result;
  }
  if (input.requirements?.conflicts.some(field => field.startsWith(input.mediaType + "."))) {
    exclusions.push({ code: "REQUIREMENT_CONFLICT", message: "本轮存在同层互斥硬要求" }); return result;
  }
  if (input.request.previewMode && input.request.previewMode !== "normal") {
    exclusions.push({ code: "DRAFT_UNSUPPORTED", message: "现有执行适配器未实现原生Draft；低分辨率仍是普通生成" }); return result;
  }
  const { model: _suggestion, previewMode: _preview, ...request } = input.request;
  const explicitVariant = explicit && exactMatches[0]?.variants?.find(variant => variant.selectionId === explicit || variant.label === explicit);
  const requestedParams = { ...(request.params as Record<string, unknown> || {}), ...preference?.params, ...(explicitVariant ? { gptImage25Mode: explicitVariant.mode } : {}) };
  const activeFacts = [...new Set(input.requirements?.facts.map(fact => fact.field) ?? [])].flatMap(field => activeFieldFacts(input.requirements!.facts, field));
  const soft = activeFacts.filter(fact => fact.strength === "soft" && fact.field.startsWith(input.mediaType + ".params.")) ?? [];
  const hardFields = new Set(activeFacts.filter(fact => fact.strength === "hard").map(fact => fact.field) ?? []);
  const softParams = soft.filter(fact => !hardFields.has(fact.field) && !(fact.field.split(".").pop()! in (preference?.params ?? {})));
  const combined = { ...requestedParams, ...Object.fromEntries(softParams.map(fact => [fact.field.split(".").pop()!, fact.value])) };
  const variants = [requestedParams, combined, ...softParams.map(fact => ({ ...requestedParams, [fact.field.split(".").pop()!]: fact.value }))];
  const accepted: { receipt: SelectionReceipt; softScore: number; evidence: Map<string, CapabilityEvidence> }[] = [];
  for (const model of exactMatches) {
    if (!model.qualification?.available) { exclusions.push({ modelId: model.id, code: "MEDIA_MODEL_UNAVAILABLE", requirementFields: [`${input.mediaType}.modelChoice`], message: model.qualification?.reasons.join(", ") || "适配器资格未验证" }); continue; }
    let failure: MatchingExclusion | undefined;
    for (const params of variants) {
      try {
        const normalized = normalizeCreativeMediaRequest(`${input.mediaType}.generate`, { ...request, model: model.id, params, references: input.references.map(identity) }, input.references, input.catalog, true);
        const output = outputContract(model.id, normalized.units, input.mediaType, normalized.params);
        if (input.outputConstraint && (output.maxReturned === undefined || input.outputConstraint.exact !== undefined && output.exactReturned !== input.outputConstraint.exact || input.outputConstraint.max !== undefined && output.maxReturned > input.outputConstraint.max)) throw new CreativeAgentError("OUTPUT_COUNT_UNSUPPORTED", "该模型的返回文件数合同无法证明满足严格数量要求", 400);
        const route = routeFor(input.mediaType, model, normalized.params, input.references.length);
        const reasons = [explicit ? "使用经用户要求或保存偏好指定的模型" : "通过当前硬参数、真实引用与输出数量合同筛选"];
        const receipt = { version: 1 as const, selectionPolicy: { ...(input.task ? { task: input.task } : {}), priorities: input.priorities ?? [], ...(input.outputConstraint ? { outputConstraint: input.outputConstraint } : {}) }, comparativeEvidenceIds: [] as string[], requirementsRevision: input.requirements?.revision ?? 0, mediaType: input.mediaType, catalogFingerprint: mediaCatalogFingerprint(input.catalog), route,
          request: { model: model.id, prompt: normalized.args.prompt, params: normalized.params, references: input.references.map(identity) }, referenceVersions: input.references.map(ref => ({ nodeId: ref.nodeId, contentVersion: ref.facts!.contentVersion })), output, reasons, evidenceLimits };
        const now = Date.parse(input.now ?? new Date().toISOString());
        const evidence = new Map((input.evidence ?? []).filter(item => item.version === 1 && item.modelId === model.id && item.providerId === route.providerId && item.task === input.task && Number.isSafeInteger(item.sampleCount) && item.sampleCount > 0 && Number.isFinite(item.value) && !!item.source && !!item.cohort && Date.parse(item.measuredAt) <= now && Date.parse(item.expiresAt) >= now
          && Object.entries(item.params).every(([key,value]) => normalized.params[key] === value) && [...item.referenceKinds].sort().join() === input.references.map(ref => ref.kind).sort().join()).map(item => [item.metric, item]));
        accepted.push({ receipt: { ...receipt, id: hashCanvasMutationPayload(receipt) }, softScore: new Set(soft.filter(fact => normalized.params[fact.field.split(".").pop()!] === fact.value).map(fact => fact.field)).size, evidence });
      } catch (error) {
        const code = error instanceof CreativeAgentError ? error.code : "MEDIA_PARAMS_INVALID";
        const fields = (error as { requirementFields?: string[] })?.requirementFields;
        const requirementFields = fields?.length ? fields : [code === "OUTPUT_COUNT_UNSUPPORTED" ? `${input.mediaType}.quantity` : code.startsWith("REFERENCE_") ? "references" : ["ADAPTER_UNSUPPORTED", "MEDIA_MODEL_UNAVAILABLE"].includes(code) ? `${input.mediaType}.modelChoice` : `${input.mediaType}.params`];
        failure = { modelId: model.id, code, requirementFields, message: error instanceof Error ? error.message : "参数组合无效" };
      }
    }
    if (!accepted.some(item => item.receipt.request.model === model.id) && failure) exclusions.push(failure);
  }
  const comparable = (input.priorities ?? []).filter(metric => {
    const rows = accepted.map(item => item.evidence.get(metric));
    return rows.length > 0 && rows.every(row => row && row.cohort === rows[0]!.cohort && row.higherIsBetter === rows[0]!.higherIsBetter);
  });
  accepted.sort((a,b) => {
    for (const metric of comparable) { const left = a.evidence.get(metric)!, right = b.evidence.get(metric)!; const diff = (right.value-left.value)*(left.higherIsBetter ? 1 : -1); if (diff) return diff; }
    return b.softScore-a.softScore || a.receipt.request.model.localeCompare(b.receipt.request.model) || a.receipt.id.localeCompare(b.receipt.id);
  });
  if (accepted[0]) {
    const selected = accepted[0].receipt;
    selected.comparativeEvidenceIds = comparable.map(metric => accepted[0].evidence.get(metric)!.id);
    selected.reasons = [...selected.reasons, ...(comparable.length ? [`依据当前同条件证据比较：${comparable.join(", ")}`] : []), ...(accepted[0].softScore ? [`满足 ${accepted[0].softScore} 项软偏好`] : []), "同等能力与证据按稳定模型ID确定选择"];
    selected.id = hashCanvasMutationPayload({ ...selected, id: undefined });
    result.selected = selected;
    result.alternatives = [...new Map(accepted.filter(item => item.receipt.request.model !== selected.request.model).map(item => [item.receipt.request.model, { modelId: item.receipt.request.model, reasons: item.receipt.reasons }])).values()];
  }
  return result;
}
