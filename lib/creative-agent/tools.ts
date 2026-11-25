import { conversationMediaArgs, validatedSubjectIntent, assertConversationReferenceVersions } from "./conversation-context";
import { directMediaAuthorization, type DirectMediaAuthorization } from './media-authorization';
import { presentGenerationStep } from "./media-presentation";
import type { MediaMatchingContext } from "./matching";
import { generationAllowance, generationExecution } from "./quantity";
import { filterSemanticQuestions, newMatchingPreferences, questionRequirementFields, requirementFields } from "./matching-contracts";
import { applyCreativeAgentMediaPreference, creativeContinuationPreference, resolveCreativeAgentPreferences } from "./preferences";
import { creativeToolActivity, creativeToolPresentation, creativeToolFailurePresentation } from "./tool-presentation";
import { describeDecisionAnswer, mediaRevisionAnswerSchema, userQuestionSchema, validateQuestionAnswer } from "./questions";
import { Type, type TSchema } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { assertDurableWorkAdmission } from "@/lib/maintenance";
import { requireCreativeAgentCanvas } from "./access";
import { CreativeAgentError } from "./errors";
import { CREATIVE_METHOD_IDS, getCreativeMethod } from "./skills";
import { listCreativeSkills, readCreativeSkill, creativeSkillHostPolicy } from "./skill-packages";
import type { CreativeAgentStore } from "./store";
import { hash, HttpError, type Decision, type DecisionPrompt, type Run } from "./store-types";
import { currentCreativeTrace, lastDebugModelSpan, newDebugSpan, recordCreativeDebug, withDebugSpan } from "./debug-trace";

export type ToolExecutionInput = { actorUserId: number; canvasId: number; runId: string; actionId: string; epoch: number; kind: string; args: Record<string, unknown>; signal?: AbortSignal; matching?: MediaMatchingContext; mediaAuthorization?: DirectMediaAuthorization; mediaApproval?: { decisionId: string; proposalHash: string } };
export type ToolExecutor = (input: ToolExecutionInput) => Promise<Record<string, unknown>>;
export type MediaPreparer = (input: ToolExecutionInput) => Promise<DecisionPrompt>;
const labels: Record<string, string> = { "canvas.read": "读取画布", "canvas.create": "创建画布内容", "canvas.patch": "修改画布内容", "canvas.focus": "定位节点", "user.ask": "等待你的选择", "image.generate": "生成图片", "video.generate": "生成视频", "generation.read": "查看生成结果", "generation.models": "查看可用生成模型", "model.guidance": "读取模型创作资料", "creative.method": "读取创作阶段方法", "skillOperator": "读取技能资料", "project.read": "读取项目约定", "project.update": "保存确认版本", "project.progress": "记录制作进度", "artifact.review": "检查分段结构", "history.read": "检索当前对话", "media.inspect": "观察引用素材" };
const readKinds = new Set(["canvas.read", "generation.read", "generation.models", "model.guidance", "creative.method", "skillOperator", "project.read", "artifact.review", "history.read", "media.inspect"]);
labels["material.prepare"] = "准备参考素材";
labels["generation.requirements"] = "记录本轮要求";
labels["generation.plan"] = "准备生成方案";
readKinds.add("generation.plan");
const rejectedBeforeDispatch = new Set(["TARGET_CHANGED", "NODE_NOT_FOUND", "PATCH_NOT_SUPPORTED", "TOOL_NOT_SUPPORTED", "CANVAS_READ_CHANGED", "RUN_SCOPE_INVALID", "AGENT_DISABLED", "CANVAS_NOT_FOUND", "MEDIA_APPROVAL_REQUIRED", "MEDIA_AUTHORIZATION_REQUIRED", "REFERENCE_CHANGED", "REFERENCE_OUTPUT_CHANGED", "REFERENCE_KIND_INVALID", "REFERENCE_NOT_READY", "MEDIA_PARAMS_INVALID", "MEDIA_MODEL_UNAVAILABLE", "MEDIA_SCOPE_INVALID", "MEDIA_NOT_FOUND", "PROJECT_CONFLICT"]);
rejectedBeforeDispatch.add("ATTACHMENT_INVALID");
rejectedBeforeDispatch.add("ATTACHMENT_NOT_FOUND");
for (const code of ["SELECTION_RECEIPT_STALE", "SELECTION_RECEIPT_REQUIRED", "REFERENCE_NOT_VERIFIED", "PLAN_DEPENDENCY_INVALID", "NORMALIZATION_CONFLICT", "QUANTITY_LIMIT", "QUANTITY_SOURCE_INVALID", "QUANTITY_RESERVATION_CONFLICT", "OUTPUT_CONTRACT_MISMATCH", "PLAN_IMMUTABLE", "MEDIA_NOT_DISPATCHED", "CONTINUATION_INVALID"]) rejectedBeforeDispatch.add(code);
export const toolKind = (name: string) => name.replace("_", ".");
export function creativeActionId(runId: string, kind: string, args: unknown, toolCallId: string): string {
  return `ca_${hash({ runId, kind, args, ...(readKinds.has(kind) ? { toolCallId } : {}) })}`;
}

export function createCreativeTools(run: Run, store: CreativeAgentStore, execute: ToolExecutor, prepareMedia: MediaPreparer = async input => (await import("./media-broker")).prepareCreativeAgentMedia(input)): AgentTool[] {
  const matchingV2 = run.input.matchingPolicyVersion === 2;
  let preferences = matchingV2 ? newMatchingPreferences(run.input.effectivePreferences ?? run.input.preferences) : resolveCreativeAgentPreferences(run.input.preferences);
  const recordUnavailable = async (fields: string[]) => {
    for (const field of new Set(fields)) {
      if (questionRequirementFields.includes(field as typeof questionRequirementFields[number])) run.input.requirements = await store.recordMatchingUnavailability(run, field);
    }
  };
  const prepare = async (input: ToolExecutionInput) => {
    try { return await prepareMedia(input); }
    catch (error) {
      if (matchingV2 && error instanceof CreativeAgentError && ["MEDIA_MODEL_UNAVAILABLE", "MEDIA_PARAMS_INVALID"].includes(error.code)) {
        const fields = (error as CreativeAgentError & { requirementFields?: string[] }).requirementFields;
        await recordUnavailable(fields?.length ? fields : [`${input.kind === "image.generate" ? "image" : "video"}.${error.code === "MEDIA_MODEL_UNAVAILABLE" ? "modelChoice" : "params"}`]);
      }
      throw error;
    }
  };
  const guard = async () => {
    await assertDurableWorkAdmission();
    await requireCreativeAgentCanvas(run.actorUserId, run.canvasId, true);
    const current = await store.assertFence(run.id, run.epoch);
    if (current) run = current;
  };
  const awaitAnswer = async (decision: Decision, signal?: AbortSignal) => {
    signal?.throwIfAborted();
    if (decision.state === "pending") {
      if (await store.defer(run.id, run.epoch, "waiting_decision")) throw new HttpError(409, "run_deferred", "等待用户确认；已释放执行槽位。");
      decision = await store.getDecision(decision.id);
    }
    if (decision.state !== "answered") throw new HttpError(409, "decision_cancelled", "本次提问已取消");
    return decision;
  };
  const invoke = (kind: string): AgentTool["execute"] => async (toolCallId, raw, signal) => {
    const debugSpan = newDebugSpan("tool"), debugStarted = performance.now();
    const parentSpanId = lastDebugModelSpan() ?? currentCreativeTrace()?.spanId;
    return withDebugSpan(debugSpan, async () => {
    signal?.throwIfAborted();
    await guard();
    const rawArgs = raw as Record<string, unknown>;
    const isMedia = kind === "image.generate" || kind === "video.generate";
    const actionScope = run.input.revision ? `${run.id}:revision:${run.input.revision}` : run.id;
    let args = rawArgs;
    let actionId = creativeActionId(actionScope, kind, args, toolCallId);
    let activityStarted = false;
    let executionEntered = false;
    const startActivity = async () => {
      await store.appendEvent(run.id, run.epoch, "tool.started", { actionId, toolCallId, name: kind, title: labels[kind], status: "running", ...(matchingV2 && isMedia ? { recovery: { revision: run.input.revision ?? 0, rawArgsHash: hash(rawArgs) } } : {}), ...(creativeToolActivity(kind,args) ? {activity:creativeToolActivity(kind,args)} : {}) });
      activityStarted = true;
    };
    recordCreativeDebug({ spanId: debugSpan, parentSpanId, category: "tool", type: "tool.started", title: labels[kind] || kind, status: "running", summary: { toolCallId, tool: kind }, detail: { arguments: args } });
    const returnResult = async (result: Record<string, unknown>, reused: boolean) => {
      signal?.throwIfAborted();
      await store.assertFence(run.id, run.epoch);
      const { images, ...summary } = result;
      await store.appendEvent(run.id, run.epoch, "tool.completed", { actionId, name: kind, title: labels[kind], status: "success", detail: creativeToolPresentation(kind, summary), ...(Array.isArray(result.nodeIds) ? { nodeIds: result.nodeIds } : {}) });
      if (typeof result.revision === "string" && Array.isArray(result.nodeIds) && kind !== "canvas.read" && kind !== "generation.models") await store.appendEvent(run.id, run.epoch, "canvas.committed", { revision: result.revision, nodeIds: result.nodeIds });
      const vision = Array.isArray(images) ? images.filter((item): item is { data: string; mimeType: string } => typeof item?.data === "string" && typeof item?.mimeType === "string") : [];
      const content = [{ type: "text" as const, text: JSON.stringify({actionId,...summary}) }, ...vision.map(item => ({ type: "image" as const, data: item.data, mimeType: item.mimeType }))];
      recordCreativeDebug({ spanId: debugSpan, parentSpanId, category: "tool", type: "tool.completed", title: `${labels[kind] || kind} · 完成`, status: reused ? "reused" : "success", summary: { actionId, toolCallId, tool: kind, elapsedMs: Math.round(performance.now() - debugStarted), nodeIds: result.nodeIds, generationIds: result.generationIds, generationId: result.generationId }, detail: { result, returnedToModel: content } });
      return { content, details: { actionId, result: summary } };
    };
    try {
      // Exact historical calls must reach their durable outcome before mutable
      // subject defaults, inline requirements or today's catalog are consulted.
      const recovery = matchingV2 && isMedia ? await store.getMediaToolCallAction?.(run, kind, toolCallId, rawArgs) : null;
      if (recovery) actionId = recovery.action.id;
      if (recovery?.exact) {
        const original = recovery.action;
        if (original.state === "failed") throw new HttpError(409, "action_failed", String((original.result as { message?: string })?.message ?? "操作此前未通过验证，请根据原因调整请求。"));
        if (original.state !== "succeeded") throw new HttpError(409, "action_not_replayable", "操作已有执行记录，不能自动再次执行；请核对已保存结果。");
        const replay = (original.result as { matchingReplay?: { requestHash: string; args: Record<string, unknown> } })?.matchingReplay;
        if (!replay?.args || original.inputHash !== hash(replay.args)) throw new HttpError(409, "media_recovery_unverified", "媒体恢复参数与持久结果不一致；不会重新准备或提交。");
        args = replay.args;
        await startActivity();
        return await returnResult(original.result as Record<string, unknown>, true);
      }
      const legacyRecoveryError = () => new HttpError(409, "media_recovery_unverified", "旧媒体调用与当前主体或要求无法准确对应，请检查已保存结果后开启新一轮；不会重新准备或提交。");
      const inlineRequirements = matchingV2 && isMedia && (rawArgs.facts !== undefined || rawArgs.continuation !== undefined);
      if (recovery && inlineRequirements) throw legacyRecoveryError();
      if (inlineRequirements || matchingV2 && kind === "generation.plan" && Array.isArray(rawArgs.facts) && rawArgs.facts.length) {
        const requirements = await store.recordRequirements(run, { facts: rawArgs.facts === undefined ? [] : rawArgs.facts, ...(inlineRequirements && rawArgs.continuation !== undefined ? { continuation: rawArgs.continuation } : {}) });
        run.input.requirements = requirements; run.input.effectivePreferences = requirements.effectivePreferences;
        preferences = newMatchingPreferences(requirements.effectivePreferences);
      }
      // Provenance belongs to the requirement ledger, never provider arguments or media identity.
      const { facts: _facts, continuation: _continuation, ...mediaArgs } = rawArgs;
      const requestArgs = matchingV2 && isMedia ? rawArgs.plan ? Object.fromEntries(Object.entries(mediaArgs).filter(([key]) => key !== "subject")) : (() => {
        try { return conversationMediaArgs(run, mediaArgs); }
        catch (error) { if (recovery) throw legacyRecoveryError(); throw error; }
      })()
        : matchingV2 && kind === "generation.plan" && Array.isArray(rawArgs.steps) ? { ...rawArgs, ...(rawArgs.subject !== undefined ? { subject: validatedSubjectIntent(run, rawArgs.subject) } : {}), steps: rawArgs.steps.map(step => {
          const current = step as Record<string, unknown>;
          if (Array.isArray(current.references) && current.references.some(ref => ref && typeof ref === "object" && "stepId" in ref)) return current;
          return conversationMediaArgs(run, { ...current, subject: rawArgs.subject });
        }) } : rawArgs;
      const planReference = matchingV2 && isMedia ? rawArgs.plan as { actionId: string; stepId: string } | undefined : undefined;
      const storedPlan = planReference ? (await store.getRun(run.id, run.actorUserId)).input.generationPlans?.[planReference.actionId]?.plan : undefined;
      if (planReference && !storedPlan) throw new CreativeAgentError("SELECTION_RECEIPT_STALE", "plan.actionId 必须是本轮 generation_plan 返回的 planActionId（或同次返回的 actionId），不能使用 generation_requirements 的记录ID；普通单步可省略 plan，由系统直接准备准确方案。", 409);
      const preference = isMedia ? creativeContinuationPreference(kind === "image.generate" ? preferences.image : preferences.video, run.input.requirements, kind === "image.generate" ? "image" : "video", rawArgs.references) : undefined;
      if (isMedia && matchingV2 && run.input.requirements?.conflicts.some(field => field.startsWith(kind === "image.generate" ? "image." : "video."))) throw new HttpError(400, "requirement_conflict", "本轮存在同层互斥要求，请仅澄清冲突字段后继续");
      args = applyCreativeAgentMediaPreference(requestArgs, preference);
      const matchingRequestHash = matchingV2 && isMedia ? hash({ ...(planReference ? {planId:storedPlan?.rootPlanId ?? planReference.actionId,stepId:planReference.stepId} : {args}), requirementsRevision: run.input.requirements?.revision ?? 0 }) : undefined;
      actionId = creativeActionId(actionScope, kind, matchingRequestHash ? { matchingRequestHash } : args, toolCallId);
      if (planReference) actionId = `ca_plan_${hash({runId:run.id,planId:storedPlan?.rootPlanId ?? planReference.actionId,stepId:planReference.stepId})}`;
      if (recovery && recovery.action.id !== actionId) { actionId = recovery.action.id; throw legacyRecoveryError(); }
      const input: ToolExecutionInput = { actorUserId: run.actorUserId, canvasId: run.canvasId, runId: run.id, actionId, epoch: run.epoch, kind, args, signal, ...(matchingV2 ? { matching: { policyVersion: 2 as const, preferences, requirements: run.input.requirements } } : {}) };
      let result: Record<string, unknown>;
      let decisionSummary: { title: string; question: string; answer: string; media?: DecisionPrompt["media"] } | undefined;
      let modelChoiceSkipped = false;
      let revision: string | undefined;
      const getExisting = () => store.getAction(actionId).catch(error => { if (error instanceof HttpError && error.code === "action_not_found") return null; throw error; });
      let existing = await getExisting();
      if (!existing && matchingV2 && isMedia && !planReference && preference?.params && requestArgs.params && typeof requestArgs.params === "object") {
        const supplied = requestArgs.params as Record<string, unknown>;
        const conflicts = Object.entries(preference.params).filter(([key, value]) => value !== undefined && supplied[key] !== undefined && supplied[key] !== value && !run.input.requirements?.facts.some(fact => fact.strength === "hard" && fact.field === `${kind === "image.generate" ? "image" : "video"}.params.${key}`));
        // The requirement store canonicalizes catalog labels; direct assistant
        // parameters may still use that same visible label. Do not coerce types.
        const options = kind === "image.generate" && conflicts.some(([key, value]) => typeof value === "string" && typeof supplied[key] === "string")
          ? await (async () => { const { getEffectiveCreativeMediaCatalog, creativeRequirementOptionEvidence } = await import("./effective-media-catalog"); return creativeRequirementOptionEvidence(await getEffectiveCreativeMediaCatalog()); })() : {};
        const canonical = (key: string, value: unknown) => {
          const matches = (options[`image.params.${key}`] ?? []).filter(option => option.value === value || option.label === value);
          return new Set(matches.map(option => option.value)).size === 1 ? matches[0].value : value;
        };
        if (conflicts.some(([key, value]) => canonical(key, supplied[key]) !== canonical(key, value))) throw new HttpError(400, "requirement_conflict", "params 与本轮有效固定参数不一致；若是用户本轮明确修改，请用 facts 记录真实原文后重试；否则省略冲突参数沿用有效偏好。不能省略失败的用户要求或声称使用了未确认规格。");
      }
      // Quantity validity gates new work. Reads, requirement repair, and the
      // existing action journal must remain available after a validator upgrade.
      if (input.matching && !existing && (isMedia || kind === "generation.plan")) {
        const total = generationAllowance(run.input).totalOutputs;
        if (total !== undefined) input.matching.outputConstraint = { max: total };
      }
      if (planReference) {
        const receipt = storedPlan?.steps.find(step => step.id === planReference.stepId && (existing || step.status === "ready"))?.receipt;
        if (!receipt || receipt.mediaType !== (kind === "image.generate" ? "image" : "video")) throw new CreativeAgentError("SELECTION_RECEIPT_STALE", "找不到本轮已就绪的计划步骤", 409);
        const { plan: _plan, ...supplied } = requestArgs;
        // The image normalizer represents an omitted, empty quality default as "".
        // Reuse that exact receipt value only; never drop unknown or nonempty fields.
        const suppliedParams = supplied.params && typeof supplied.params === "object" && !Array.isArray(supplied.params)
          && receipt.mediaType === "image" && receipt.request.params.quality === "" && !("quality" in supplied.params)
          ? { ...supplied.params, quality: "" } : supplied.params;
        if (supplied.prompt !== undefined && supplied.prompt !== receipt.request.prompt || supplied.model !== undefined && supplied.model !== receipt.request.model || supplied.params !== undefined && hash(suppliedParams) !== hash(receipt.request.params) || supplied.references !== undefined && hash(supplied.references) !== hash(receipt.request.references)) throw new CreativeAgentError("SELECTION_RECEIPT_STALE", "调用参数与计划收据不一致，请重新制定方案", 409);
        const subject = rawArgs.subject ?? storedPlan?.definition.subject;
        if (subject !== undefined && rawArgs.subject !== undefined && storedPlan?.definition.subject && hash(rawArgs.subject) !== hash(storedPlan.definition.subject)) throw new CreativeAgentError("SUBJECT_REFERENCE_CONFLICT", "主体变更与已保存计划不一致", 409);
        if (!storedPlan?.definition.steps.find(step => step.id === planReference.stepId)?.references.some(ref => "stepId" in ref)) conversationMediaArgs(run, { ...receipt.request, subject });
        args = receipt.request; input.args = args; input.matching!.receipt = receipt;
      }
      // Completed media is historical evidence: do not rematch it against today's catalog.
      const replay = existing?.state === "succeeded" ? (existing.result as { matchingReplay?: { requestHash: string; args: Record<string, unknown> } })?.matchingReplay : undefined;
      if (matchingRequestHash && replay?.requestHash === matchingRequestHash) { args = replay.args; input.args = args; }
      let matchedPrompt: DecisionPrompt | undefined;
      if (isMedia && matchingV2 && !existing) {
        matchedPrompt = await prepare(input);
        const receipt = matchedPrompt.media?.selectionReceipt;
        if (receipt) {
          assertConversationReferenceVersions(run, receipt);
          args = receipt.request; input.args = args; input.matching!.receipt = receipt;
          const planId = planReference?.actionId ?? `plan:${actionId}`;
          const stepId = planReference?.stepId ?? "single";
          if (!planReference) {
            const definition = { steps: [{ id: stepId, role: "final" as const, mediaType: receipt.mediaType, prompt: receipt.request.prompt, params: receipt.request.params, references: receipt.request.references as import("./media-capabilities").CreativeAgentMediaReference[], dependsOn: [] }] };
            await store.saveGenerationPlan(run, planId, { version: 1, definition, requirementsRevision: receipt.requirementsRevision, steps: [{ id: stepId, role: "final", mediaType: receipt.mediaType, dependsOn: [], status: "ready", receipt }], totals: { plannedCalls: receipt.output.calls, readyCalls: receipt.output.calls, unreadySteps: 0, minReturned: receipt.output.minReturned, maxReturned: receipt.output.maxReturned }, evidenceLimits: receipt.evidenceLimits ?? [] });
          }
          const current = await store.getRun(run.id, run.actorUserId);
          input.matching!.execution = generationExecution(current.input, planId, stepId);
          matchedPrompt = { ...matchedPrompt, media: matchedPrompt.media ? {...matchedPrompt.media,planSummary:presentGenerationStep(receipt,input.matching!.execution,current.input.generationPlans?.[planId]?.plan)} : undefined, binding: { ...matchedPrompt.binding!, version: 2, retryLimit: input.matching!.execution.limits.retryCalls, ...input.matching!.execution } };
        }
      }
      const preferred = preference?.mode === "explicit" ? preference.model : undefined;
      if (!matchingV2 && preferred && rawArgs.model && rawArgs.model !== preferred) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", `本轮已选择模型 ${preferred}，请使用该模型准备方案；若能力不匹配，请说明并等待用户调整选择。`, 400);
      if (!matchingV2 && preference?.mode === "auto" && (typeof args.model !== "string" || !args.model.trim())) throw new CreativeAgentError("MEDIA_MODEL_UNAVAILABLE", "已启用智能匹配：请先调用 generation_models，按本轮任务、参考素材及固定参数选择真实可用模型，并传入 model；无匹配候选时说明冲突，不要询问用户重新选择模型或降低规格。", 400);
      if (isMedia && !matchingV2 && !existing) {
        let model = preferred;
        if (!model && preference?.mode !== "auto") {
          const fieldId = kind === "image.generate" ? "imageModel" : "videoModel";
          let choice = await store.getModelChoice(run.id, fieldId);
          if (!choice) {
            const { model: _suggestedModel, ...selectionArgs } = args;
            const choiceId = `ca_model_${hash({ runId: actionScope, kind, args: selectionArgs })}`;
            const prompt = await prepare({ ...input, actionId: choiceId, args: selectionArgs });
            choice = await awaitAnswer(await store.ask(run, choiceId, prompt), signal);
          }
          const answer = validateQuestionAnswer(choice.fields || [], choice.answer);
          model = "values" in answer && typeof answer.values[fieldId] === "string" ? answer.values[fieldId] as string : undefined;
          modelChoiceSkipped = !model;
          const summary = describeDecisionAnswer(choice, choice.answer);
          decisionSummary = { title: choice.title, question: choice.question, ...summary };
        }
        if (model) {
          args = { ...args, model };
          actionId = creativeActionId(actionScope, kind, args, toolCallId);
          input.actionId = actionId;
          input.args = args;
          existing = await getExisting();
        }
      }
      if (!isMedia || existing) await startActivity();
      if (existing) {
        if (existing.inputHash !== hash(args) || existing.kind !== kind || existing.runId !== run.id) throw new HttpError(409, "action_id_conflict", "操作记录与本次参数不符");
        if (existing.state === "failed") throw new HttpError(409, "action_failed", String((existing.result as { message?: string })?.message ?? "操作此前未通过验证，请根据原因调整请求。"));
        if (existing.state !== "succeeded") throw new HttpError(409, "action_not_replayable", "操作已有执行记录，不能自动再次执行；请核对已保存结果。");
        result = existing.result as Record<string, unknown>;
        recordCreativeDebug({ spanId: debugSpan, parentSpanId, category: "tool", type: "tool.reused", title: "复用已执行工具结果", status: "reused", summary: { actionId, toolCallId } });
      } else if (kind === "user.ask") {
        const parsed = userQuestionSchema.safeParse(args);
        if (!parsed.success) throw new HttpError(400, "invalid_question", parsed.error.issues.map(issue => issue.message).join("；"));
        // Legacy prompts and their hashes remain byte-for-byte compatible.
        let prompt: DecisionPrompt = parsed.data.fields ? { ...parsed.data, options: [] } : args as DecisionPrompt;
        let prior: Decision[] = [];
        if (matchingV2) {
          if (!prompt.fields?.length) throw new HttpError(400, "invalid_question", "新运行必须使用带 semantic 目的与需求关联的 fields");
          const state = run.input.requirements ?? { revision: 0, conflicts: [] };
          try { filterSemanticQuestions(prompt.fields, newMatchingPreferences(preferences), state, []); }
          catch (error) { throw new HttpError(400, "invalid_question", error instanceof Error ? error.message : "无效问题语义"); }
          prior = await store.getSemanticQuestions(run.id);
          const pending = prior.find(item => item.state === "pending" && item.fields?.some(field => field.semantic?.revision === state.revision && prompt.fields!.some(next => next.semantic?.unresolvedId === field.semantic?.unresolvedId || next.semantic?.requirement === field.semantic?.requirement && next.semantic?.purpose === field.semantic?.purpose)));
          if (pending) {
            const decision = await awaitAnswer(pending, signal);
            prior = prior.map(item => item.id === decision.id ? decision : item);
          }
          const asked = prior.flatMap(item => item.fields?.flatMap(field => field.semantic ? [field.semantic] : []) ?? []);
          const fields = filterSemanticQuestions(prompt.fields, newMatchingPreferences(preferences), state, asked);
          prompt = { ...prompt, ...(fields.length !== prompt.fields.length ? { title: "补充必要条件", question: "请补充以下必要条件。" } : {}), fields };
        }
        if (matchingV2 && !prompt.fields?.length) {
          result = { suppressed: true, effectivePreferences: preferences, requirements: run.input.requirements, answers: prior.filter(item => item.state === "answered").map(item => ({ decisionId: item.id, fields: item.fields, answer: item.answer })), message: "已知条件或本版本已问过的缺项不重复提问。跳过不是确认或生成授权；根据有效偏好继续可独立完成的工作。" };
        } else {
          const decision = await awaitAnswer(await store.ask(run, actionId, prompt), signal);
          const summary = describeDecisionAnswer(decision, decision.answer);
          result = { decisionId: decision.id, fields: decision.fields, ...summary, ...(typeof decision.answer === "object" && decision.answer !== null ? decision.answer : {}), decision: { title: decision.title, question: decision.question, ...summary } };
        }
      } else if (kind === "generation.requirements" && matchingV2) {
        const requirements = await store.recordRequirements(run, args);
        run.input.requirements = requirements;
        run.input.effectivePreferences = requirements.effectivePreferences;
        preferences = newMatchingPreferences(requirements.effectivePreferences);
        result = { requirements, effectivePreferences: requirements.effectivePreferences, message: "已记录本轮要求，保存偏好未改变；这不是生成授权。" };
      } else {
        let cancelled = modelChoiceSkipped;
        if (!modelChoiceSkipped && (isMedia || kind === "project.update")) {
          // Waiting for approval is not a claimed dispatch. A restart resumes this exact
          // decision; only a confirmed generation enters the side-effect journal.
          const prompt = kind === "project.update" ? await (await import("./project-state")).prepareCreativeProjectDecision(input) : matchedPrompt ?? await prepare(input);
          const current = isMedia && run.input.mediaAuthorizationVersion === 1 ? await store.getRun(run.id) : undefined;
          const decisions = current ? await (await import('@/lib/prisma')).default.creativeAgentDecision.findMany({ where: { runId: run.id }, orderBy: { createdAt: 'asc' } }) as unknown as Decision[] : [];
          if (current && !decisions.some(item => item.actionId === actionId)) {
            input.mediaAuthorization = prompt.binding ? directMediaAuthorization(current, kind, prompt.binding, decisions) : undefined;
            if (!input.mediaAuthorization) throw new CreativeAgentError('MEDIA_AUTHORIZATION_REQUIRED', '当前消息尚未明确授权这类生成或修改；只补充缺少的生成目标或意图，不必重复确认已知模型和参数。');
          } else {
          if (isMedia && !activityStarted) await startActivity();
          recordCreativeDebug({ spanId: debugSpan, parentSpanId, category: "tool", type: "tool.approval", title: "等待确认本次参数", status: "waiting", detail: prompt });
          const decision = await awaitAnswer(await store.ask(run, actionId, prompt), signal);
          cancelled = decision.answer !== "approve";
          const revisionAnswer = isMedia ? mediaRevisionAnswerSchema.safeParse(decision.answer) : null;
          if (revisionAnswer?.success) revision = revisionAnswer.data.revision;
          decisionSummary = { title: decision.title, question: decision.question, ...describeDecisionAnswer(decision, decision.answer), ...(decision.media ? { media: decision.media } : {}) };
          input.mediaApproval = { decisionId: decision.id, proposalHash: decision.proposalHash };
          }
        }
        signal?.throwIfAborted();
        await guard();
        if (isMedia && !activityStarted) await startActivity();
        const receipt = await store.claimAction({ ...input, inputHash: hash(args) });
        if (!receipt.claimed) {
          if (receipt.state !== "succeeded") throw new HttpError(409, "action_not_replayable", "操作结果尚未确认，不能自动重试。");
          result = receipt.result as Record<string, unknown>;
        } else {
          try {
            if (kind === "generation.plan" && matchingV2) {
              const plan = await (await import("./generation-plan")).createCreativeGenerationPlan(input);
              for (const step of plan.steps) if (step.receipt) assertConversationReferenceVersions(run, step.receipt);
              await store.saveGenerationPlan(run, actionId, plan);
              await recordUnavailable(plan.steps.filter(step => step.status === "unavailable").flatMap(step => step.exclusions?.flatMap(item => item.requirementFields ?? []) ?? []));
              result = { planActionId: actionId, plan };
            } else if (kind === "skillOperator") {
              if (args.action === "list") result = { skills: await listCreativeSkills(run.actorUserId) };
              else if (args.action === "read" && typeof args.skillId === "string" && (args.path === undefined || typeof args.path === "string")) result = { ...await readCreativeSkill(run.actorUserId, args.skillId, args.path, args.revision as number | undefined), ...(matchingV2 ? { hostPolicy: creativeSkillHostPolicy(run.input.mediaAuthorizationVersion) } : {}) };
              else throw new CreativeAgentError("SKILL_NOT_FOUND", "请先查询技能目录，再提供有效的 skillId 和 path 读取资料。", 400);
            } else if (kind === "creative.method") {
              const method = getCreativeMethod(String(args.methodId));
              if (!method) throw new CreativeAgentError("TOOL_NOT_SUPPORTED", "该创作方法不在允许目录内", 400);
              result = { ...method };
            } else {
            executionEntered = !cancelled;
            result = cancelled ? { cancelled: true, ...(modelChoiceSkipped ? { skipped: true } : {}), ...(revision ? { revisionRequested: true, revision, ...(matchingV2 ? { decisionId: input.mediaApproval!.decisionId, revisionSource: { kind: "answer", sourceId: input.mediaApproval!.decisionId, channel: "revision", quote: revision } } : {}) } : {}), message: revision ? "用户要求修改需求，旧方案未批准且未提交生成。请按修改意见重新制定方案并展示新的确认卡，不能沿用旧批准或自行开始生成。" : "用户取消或未选择本次操作，未改变确认记录或提交生成任务。" } : await execute(input);
            }
            if (isMedia && (rawArgs.subject ?? storedPlan?.definition.subject) !== undefined) result = { ...result, conversationSubject: validatedSubjectIntent(run, rawArgs.subject ?? storedPlan?.definition.subject) };
            if (input.matching?.execution) result = {...result,planExecution:input.matching.execution};
            if (matchingRequestHash) result = { ...result, matchingReplay: { requestHash: matchingRequestHash, args } };
            if (decisionSummary) result = { ...result, decision: decisionSummary };
            await store.completeAction(actionId, { runId: run.id, epoch: run.epoch, state: "succeeded", result });
          } catch (error) {
            // The executor may have dispatched before losing its receipt. Never infer
            // failure from a thrown transport/DB exception and never replay it.
            const rejected = readKinds.has(kind) || (error instanceof CreativeAgentError || error instanceof HttpError) && (rejectedBeforeDispatch.has(error.code) || ["stale_epoch", "run_not_found"].includes(error.code));
            const priorResult = (await store.getAction(actionId).catch(() => null))?.result;
            const evidence = error as { generationIds?: unknown; requestKeys?: unknown };
            const result = { ...(priorResult && typeof priorResult === "object" ? priorResult : {}), ...(input.matching?.execution ? {planExecution:input.matching.execution} : {}), ...(rejected ? {rejectedBeforeDispatch:true,code:(error as {code?:string}).code || "MEDIA_NOT_DISPATCHED"} : {}), message: rejected ? error instanceof Error ? error.message : "读取未完成，请核对素材状态与输入格式。" : "执行结果未确认，请核对任务或画布记录。", ...(Array.isArray(evidence.generationIds) ? { generationIds: evidence.generationIds } : {}), ...(Array.isArray(evidence.requestKeys) ? { requestKeys: evidence.requestKeys } : {}) };
            await store.completeAction(actionId, { runId: run.id, epoch: run.epoch, state: rejected ? "failed" : "unknown", result }).catch(() => undefined);
            if (!rejected) {
              await store.appendEvent(run.id, run.epoch, "tool.completed", { actionId, name: kind, title: labels[kind], status: "error", detail: {receiptState:"unknown",code:error instanceof CreativeAgentError || error instanceof HttpError ? error.code : "tool_interrupted",message:"执行结果未确认，已暂停；请核对任务或画布记录。"} }).catch(() => undefined);
              await store.control(run.id, run.actorUserId, `pause:${actionId}`, "pause", run.epoch).catch(() => undefined);
            }
            throw error;
          }
        }
      }
      return await returnResult(result, Boolean(existing));
    } catch (error) {
      const deferred = error instanceof HttpError && error.code === "run_deferred";
      const journalActionId = actionId;
      const preflight = !activityStarted;
      if (preflight) {
        // A rejected attempt is not the dispatch journal identity. Keep it visible
        // when a corrected invocation of the same plan later succeeds.
        actionId = `ca_preflight_${hash({ runId: actionScope, kind, toolCallId })}`;
        await startActivity().catch(() => undefined);
      }
      const code = error instanceof HttpError || error instanceof CreativeAgentError ? error.code : "tool_interrupted";
      const message = error instanceof HttpError || error instanceof CreativeAgentError ? error.message : "操作未完成，请根据画布状态核对结果。";
      const failurePhase: Record<string, unknown> = {};
      let receiptKnown = true;
      const action = await store.getAction(journalActionId).catch(error => { if (!(error instanceof HttpError && error.code === "action_not_found")) receiptKnown = false; return null; });
      const prior = action?.result && typeof action.result === "object" ? action.result as Record<string, any> : {};
      const media = kind === "image.generate" || kind === "video.generate";
      const admission = ["stale_epoch", "run_not_found", "run_deferred", "decision_cancelled", "AGENT_DISABLED", "CANVAS_NOT_FOUND", "RUN_SCOPE_INVALID"].includes(code);
      if (!receiptKnown && media || action?.state === "unknown" || ["MEDIA_DISPATCH_UNKNOWN", "media_recovery_unverified"].includes(code)) failurePhase.receiptState = "unknown";
      else if (media && executionEntered) {
        // Persisted dispatch evidence outranks the local entry flag and any error code.
        // Read only the current action's scoped keys, never infer no submission from a
        // missing generation receipt after an uncertain executor exception.
        try {
          const current = await store.getRun(run.id);
          const reservations = current.input.quantityLedger?.reservations.filter(item => item.actionId === journalActionId) ?? [];
          const keys = [...new Set([...(Array.isArray(prior.mediaDispatch?.requestKeys) ? prior.mediaDispatch.requestKeys : []), ...reservations.map(item => item.requestKey)])] as string[];
          const rows = keys.length ? await (await import('@/lib/prisma')).default.generation.findMany({ where: { authUserId: run.actorUserId, canvasId: run.canvasId, requestKey: { in: keys } }, select: { id: true } }) : [];
          const submitted = rows.length > 0 || typeof prior.generationId === "number" || Array.isArray(prior.generationIds) && prior.generationIds.length > 0;
          if (submitted && rejectedBeforeDispatch.has(code)) failurePhase.dispatchState = "partial";
          else if (submitted || reservations.some(item => item.phase === "started" || item.observation) || !rejectedBeforeDispatch.has(code)) failurePhase.receiptState = "unknown";
          else if (!admission) Object.assign(failurePhase, { phase: "preflight", dispatched: false });
        } catch { failurePhase.receiptState = "unknown"; }
      } else if (!executionEntered && receiptKnown && !deferred && !admission && !action) Object.assign(failurePhase, { phase: "preflight", dispatched: false });
      else if (prior.receiptState === "unknown") failurePhase.receiptState = "unknown";
      const detail = { status: deferred ? "waiting" : "error", ...failurePhase, code, message: failurePhase.dispatchState === "partial" ? `已有部分任务提交。后续准备未通过：${message}` : failurePhase.receiptState === "unknown" ? `执行结果待核实；以下错误不能证明未提交：${message}` : message, ...(creativeToolActivity(kind,args) ? {activity:creativeToolActivity(kind,args)} : {}) };
      const presentation = creativeToolFailurePresentation(kind, detail);
      const title = presentation?.title || labels[kind] || kind;
      recordCreativeDebug({ spanId: debugSpan, parentSpanId, category: "tool", type: deferred ? "tool.waiting" : "tool.failed", title: deferred ? "已挂起，等待用户确认" : `${title} · ${presentation?.outcomeLabel || "未完成"}`, status: deferred ? "waiting" : "error", summary: { actionId, toolCallId, elapsedMs: Math.round(performance.now() - debugStarted) }, detail });
      await store.appendEvent(run.id, run.epoch, "tool.completed", { actionId, toolCallId, name: kind, title, status: deferred ? "waiting" : "error", detail }).catch(() => undefined);
      if (error instanceof HttpError || error instanceof CreativeAgentError) throw error;
      throw new HttpError(500, "tool_interrupted", "操作未完成，请核对已保存的结果。");
    }
    });
  };
  const text = Type.String({ maxLength: 20000 });
  const title = Type.String({ minLength: 1, maxLength: 150 });
  const reference = Type.Object({ nodeId: Type.String(), semanticHash: Type.String({ pattern: "^[a-f0-9]{64}$" }), batchId: Type.Optional(Type.String()), outputId: Type.Optional(Type.String()), mediaId: Type.Optional(Type.String()), generationId: Type.Optional(Type.Integer({ minimum: 1 })) }, { additionalProperties: false });
  const questionOption = Type.Object({ value: Type.String({ minLength: 1, maxLength: 200 }), label: Type.String({ minLength: 1, maxLength: 300 }), description: Type.Optional(Type.String({ maxLength: 500 })), recommended: Type.Optional(Type.Boolean()) }, { additionalProperties: false });
  const semantic = Type.Object({ purpose: Type.Union(["missing_input", "target_ambiguity", "hard_conflict", "unavailable_requirement", "budget_change"].map(value => Type.Literal(value))), requirement: Type.Union(questionRequirementFields.map(value => Type.Literal(value))), unresolvedId: Type.String({ minLength: 1, maxLength: 128 }), revision: Type.Integer({ minimum: 0 }) }, { additionalProperties: false });
  const questionField = Type.Object({ ...(matchingV2 ? { semantic } : {}), id: Type.String({ pattern: "^[a-zA-Z][a-zA-Z0-9_]{0,63}$" }), title: Type.String({ minLength: 1, maxLength: 200 }), type: Type.Union(["radio", "checkbox", "select", "text", "textarea", "number", "switch"].map(value => Type.Literal(value))), required: Type.Optional(Type.Boolean()), description: Type.Optional(Type.String({ maxLength: 500 })), placeholder: Type.Optional(Type.String({ maxLength: 300 })), options: Type.Optional(Type.Array(questionOption, { minItems: 1, maxItems: 128 })) }, { additionalProperties: false });
  const tool = (name: string, description: string, parameters: AgentTool["parameters"]): AgentTool => ({ name, label: labels[toolKind(name)], description: run.input.mediaAuthorizationVersion === 1 && (name === "image_generate" || name === "video_generate") ? description.replace("动态匹配并准确审批", "动态匹配并按当前明确请求执行").replace("批准后提交，auto/跳过不授权", "仅本轮明确执行请求授权，auto/跳过不授权").replace("批准后提交1次；auto/跳过不授权", "按本轮明确执行请求提交1次；auto/跳过不授权") : description, parameters, executionMode: "sequential", execute: invoke(toolKind(name)) });
  const source = Type.Object({ kind: Type.String({ enum: ["message", "answer"] }), sourceId: Type.String(), fieldId: Type.Optional(Type.String()), channel: Type.Optional(Type.String({ enum: ["values", "notes", "revision"] })), start: Type.Optional(Type.Integer({ minimum: 0 })), end: Type.Optional(Type.Integer({ minimum: 1 })), quote: Type.String({ minLength: 1, maxLength: 4000 }) }, { additionalProperties: false, description: "quote逐字匹配。唯一引用省略 start/end；重复引用用 UTF-16 [start,end)，错误偏移拒绝。" });
  const continuation = Type.Object({ directive: source, targets: Type.Array(Type.Object({ sourceActionId: Type.String({ description: "先前成功 image_generate/video_generate 的actionId；非plan/requirements/generation/nodeID" }), reference }, { additionalProperties:false }), {minItems:1,maxItems:16}) }, {additionalProperties:false});
  // Keep the value opaque to SDK conversion; conditional JSON-schema branches
  // validate its original type. A broad union can coerce valid numbers to strings.
  const factValue = (field: { enum: readonly string[] } | { pattern: string }, value: TSchema) => ({ if: { properties: { field } }, then: { properties: { value } } });
  const fact = Type.Object({ field: Type.String({ enum: requirementFields }), value: Type.Unknown(), strength: Type.String({ enum: ["hard", "soft"] }), source }, { additionalProperties: false, description: "仅本轮原文/回答；已保存偏好不用重复填facts。数量：普通图/视频数用image/video.quantity；总共/总量/上限用generation.totalOutputs，可同时记前者，不重复finalOutputs；finalOutputs仅明确最终数。不要让我选/不再问模型只沿用当前选择，不填modelChoice；明确自动/智能匹配/你来选才填auto。", allOf: [
    factValue({ pattern: "\\.modelChoice$" }, Type.Union([Type.Object({ mode: Type.Literal("auto") }, { additionalProperties: false }), Type.Object({ mode: Type.Literal("explicit"), model: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false }), Type.Object({ mode: Type.Literal("explicit"), unresolvedAlias: Type.String({ minLength: 1, maxLength: 256 }) }, { additionalProperties: false })])),
    factValue({ pattern: "\\.(quantity|duration)$" }, Type.Integer({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
    factValue({ pattern: "^generation\\." }, Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
    factValue({ enum: ["video.params.generateAudio"] }, Type.Boolean()),
    factValue({ enum: ["intent"] }, Type.String({ enum: ["discuss", "prepare", "generate", "edit", "inspect"], description: "本轮操作意图；创意描述放入 prompt" })),
    factValue({ pattern: "\\.params\\.(aspectRatio|resolution|quality|ratio)$" }, Type.String({ minLength: 1, maxLength: 256 })),
    factValue({ enum: ["image.params.background"] }, Type.String({ minLength: 1, maxLength: 256, description: "透明通道选项；背景颜色/材质/场景写入prompt" })),
  ] });
  const subject = Type.Optional(Type.Object({ mode: Type.Union([Type.Literal("clear"), Type.Literal("replace"), Type.Literal("combine")]), source }, { additionalProperties: false, description: "仅当前用户明确不用产品/参考、换独立主体或合并时传；source须本轮原文。省略保持当前主体整组引用，完整prompt保留该主体。" }));
  const mediaBase = { ...(matchingV2 ? { subject, facts: Type.Optional(Type.Array(fact, { maxItems: 64 })), continuation: Type.Optional(continuation) } : {}), ...(matchingV2 ? { plan: Type.Optional(Type.Object({ actionId: Type.String({ description: "仅 generation_plan 返回的 planActionId/actionId，不能用 generation_requirements 记录ID" }), stepId: Type.String() }, { additionalProperties: false, description: "绑定已准备步骤，可省略 prompt/params/references并复用准确收据；显式差异拒绝。独立单步省略plan" })) } : {}), model: Type.Optional(Type.String({ minLength: 1 })), prompt: matchingV2 ? Type.Optional(Type.String({ minLength: 1, maxLength: 20000 })) : Type.String({ minLength: 1, maxLength: 20000 }), references: Type.Optional(Type.Array(reference, { maxItems: 16 })) };
  const mediaSchema = (properties: Record<string, TSchema>, directRequired: string[]) => Type.Object(properties, { additionalProperties: false, ...(matchingV2 ? { allOf: [{ if: { not: { required: ["plan"] } }, then: { required: directRequired } }] } : {}) });
  const optionalForPlan = (schema: TSchema) => matchingV2 ? Type.Optional(schema) : schema;
  return [
    ...(matchingV2 ? [tool("generation_plan", "准备完整多产物/多步媒体计划；独立单步可直接生成工具内联facts/continuation。facts遵循generation_requirements，不额外请求模型；组合分项由服务器求和。参数用目录value/真实label，不读价格。列全最终/中间步骤、稳定ID、提示词、参数、引用及依赖；未来素材用stepId/outputIndex，未绑定保持blocked，不编造节点或偷生中间图。返回planActionId/actionId及逐步收据与数量合同；" + (run.input.mediaAuthorizationVersion === 1 ? "本轮明确执行请求才提交，仅准备不执行；缺项、冲突或新增超额才问。" : "执行仍需准确审批。") + "生成工具仅传plan引用即可。", Type.Object({ subject, facts: Type.Optional(Type.Array(fact, { maxItems: 64 })), task: Type.Optional(Type.String({ maxLength: 500 })), priorities: Type.Optional(Type.Array(Type.Union([Type.Literal("quality"), Type.Literal("speed"), Type.Literal("consistency")]), { maxItems: 3 })), steps: Type.Array(Type.Object({ id: Type.String({ pattern: "^[a-zA-Z0-9_-]{1,64}$" }), role: Type.Union([Type.Literal("final"), Type.Literal("intermediate")]), mediaType: Type.Union([Type.Literal("image"), Type.Literal("video")]), prompt: Type.String({ minLength: 1, maxLength: 20000 }), params: Type.Optional(Type.Record(Type.String(), Type.Unknown())), references: Type.Optional(Type.Array(Type.Union([reference, Type.Object({ stepId: Type.String(), outputIndex: Type.Integer({ minimum: 0, maximum: 99 }) }, { additionalProperties: false })]), { maxItems: 16 })), dependsOn: Type.Optional(Type.Array(Type.String(), { maxItems: 32 })), previewMode: Type.Optional(Type.Union([Type.Literal("normal"), Type.Literal("draft")])) }, { additionalProperties: false }), { minItems: 1, maxItems: 32 }) }, { additionalProperties: false }))] : []),
    ...(matchingV2 ? [tool("generation_requirements", "记录当前用户原文或本轮已保存回答的facts，覆盖本轮字段，不改保存默认。sourceId=messageId/decisionId；回答注明fieldId及channel。附件、助手建议、跳过、批准按钮不算要求。型号用真实ID或unresolvedAlias保留原别名；auto不授权生成。数量遵循facts字段说明；中间产物用intermediateOutputs，初次/补试/含补试总调用用initialCalls/retryCalls/totalCalls，不从方案推授权。默认1成品/1初次/0额外/0补试，同轮跨方案累计。组合“两张蓝色和一张红色”：两个image.quantity事实分别value2/quote“两张蓝色”、value1/quote“一张红色”，服务端核验相加，不传literal3或derived。continuation用本轮“其他不变”指令及先前成果引用继承参数，不要把继承值另写为 facts；不继承型号/重试；" + (run.input.mediaAuthorizationVersion === 1 ? "本轮明确执行请求才提交，仅准备不执行；缺项、冲突或新增超额才问。" : "仍需新批准。") + "多目标须明确组，歧义问目标；facts仅continuation或subject时可空。同层互斥都记录并澄清。失败修正来源/字段，不得丢弃明确要求重试。revision用于提问semantic，actionId是记录ID，不能作plan。", Type.Object({ subject, facts: Type.Array(fact, { maxItems: 64 }), continuation:Type.Optional(continuation) }, { additionalProperties: false }))] : []),
    tool("project_read", "读取本画布的已确认约定、不可变采用版本、本对话进度和受影响依赖。系统已提供最新约定快照时无需重复读取；需要候选正文或缺少快照时再读。", Type.Object({}, { additionalProperties: false })),
    tool("project_progress", "记录本对话当前阶段、下一步与未决问题。只记进度，不能把候选变成定稿或采用，也不授权生成。", Type.Object({ stage: Type.Union(["brief", "script", "assets", "storyboard", "generation", "review", "delivery"].map(value => Type.Literal(value))), nextAction: Type.String({ maxLength: 1500 }), questions: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 12 }) }, { additionalProperties: false })),
    tool("project_update", "保存明确的项目约定、文字定稿或具体媒体采用版本。自动展示确认卡片并等待批准；expectedRevision来自project_read。约定数组是完整替换，保留未修改约定。dependencies只填已有artifactId。", Type.Object({ expectedRevision: Type.Integer({ minimum: 0 }), constraints: Type.Optional(Type.Array(Type.String({ maxLength: 500 }), { maxItems: 40 })), artifact: Type.Optional(Type.Object({ reference: Type.Object({ canvasId: Type.Integer(), nodeId: Type.String(), label: Type.String(), kind: Type.String(), semanticHash: Type.String(), batchId: Type.Optional(Type.String()), outputId: Type.Optional(Type.String()), mediaId: Type.Optional(Type.String()), generationId: Type.Optional(Type.Integer()) }, { additionalProperties: false }), status: Type.Union([Type.Literal("confirmed"), Type.Literal("adopted")]), dependencies: Type.Array(Type.String(), { maxItems: 30 }) }, { additionalProperties: false })), revokeId: Type.Optional(Type.String()), reason: Type.Optional(Type.String({ maxLength: 1000 })) }, { additionalProperties: false })),
    tool("artifact_review", "校验分段时间轴、计划总时长、段号和引用节点。只做结构检查，不能代替剧情或媒体观察；最多局部修正两轮，仍有冲突说明缺项。", Type.Object({ totalDuration: Type.Number({ minimum: 0.01, maximum: 7200 }), maxSegmentDuration: Type.Optional(Type.Number({ minimum: 0.01, maximum: 7200 })), segments: Type.Array(Type.Object({ id: Type.String(), start: Type.Number(), end: Type.Number(), prompt: Type.String(), references: Type.Array(Type.String()) }, { additionalProperties: false }), { minItems: 1, maxItems: 300 }) }, { additionalProperties: false })),
    tool("media_inspect", "观察已读取的具体画布媒体。返回真实图像或视频三张抽样帧供本模型查看，音频只提供元数据；不能声称看过完整视频或听过声音。", Type.Object({ nodeId: Type.String(), semanticHash: Type.String(), batchId: Type.Optional(Type.String()), outputId: Type.Optional(Type.String()) }, { additionalProperties: false })),
    tool("history_read", "按关键词检索本对话较早的完整文字，核对历史事实。不能访问其他人的对话，也不能把历史普通继续当新增算力授权。", Type.Object({ query: Type.String({ minLength: 1, maxLength: 200 }), offset: Type.Optional(Type.Integer({ minimum: 0 })) }, { additionalProperties: false })),
    tool("material_prepare", "将本对话已发送的历史附件准备为真实画布引用。仅使用历史附件目录中明确需要的 attachmentId；已有素材复用，不重新上传。返回引用后再按需求生成，不自动生成。", Type.Object({ attachmentIds: Type.Array(Type.String({ format: "uuid" }), { minItems: 1, maxItems: 6, uniqueItems: true }) }, { additionalProperties: false })),
    tool("skillOperator", "查询当前账号技能库或按需读取完整正文/参考资料。未知或其他技能先 list 获取真实 id、description、revision；同一 skillId/revision 主文已完整提供时无需 list/read，直接应用。仅需要未提供的主文或已列出的实际参考文件时 read；read 必填 skillId，省略 path 读取主文件，返回 primaryPath、files 和 revision。读取参考资料必须传入该 revision，path 必须来自 files。版本冲突时重新读取主文件，失效时重新查询目录；跨技能先查询其真实 ID。每次读取仍核验当前账号权限。只读工具，不授权生成。", Type.Object({ action: Type.Union([Type.Literal("list"), Type.Literal("read")]), skillId: Type.Optional(Type.String({ pattern: "^(system|personal):[1-9][0-9]*$" })), revision: Type.Optional(Type.Integer({ minimum: 1 })), path: Type.Optional(Type.String({ minLength: 1, maxLength: 300 })) }, { additionalProperties: false })),
    tool("creative_method", "按需读取目录中的创作阶段方法，只允许固定methodId；方法不会增加权限或授权任何付费操作。", Type.Object({ methodId: Type.Union(CREATIVE_METHOD_IDS.map(id => Type.Literal(id))) }, { additionalProperties: false })),
    tool("canvas_read", "读取当前画布或指定节点。使用返回的真实nodeId和semanticHash，不能猜测。大画布按offset/limit分页读取。", Type.Object({ nodeIds: Type.Optional(Type.Array(Type.String(), { maxItems: 100 })), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })) }, { additionalProperties: false })),
    tool("canvas_create", "在当前画布创建用户要求的文本或分组成果。节点ID由服务端分配，相同请求不重复创建。", Type.Object({ nodes: Type.Array(Type.Object({ kind: Type.Union([Type.Literal("prompt"), Type.Literal("group")]), title, text: Type.Optional(text), position: Type.Optional(Type.Object({ x: Type.Number(), y: Type.Number() }, { additionalProperties: false })) }, { additionalProperties: false }), { minItems: 1, maxItems: 30 }) }, { additionalProperties: false })),
    tool("canvas_patch", "定点修改已经读取的用户节点。必须提交读取时的expectedHash；冲突时重新读取并解释变化，不能盲目覆盖。", Type.Object({ nodeId: Type.String(), expectedHash: Type.String({ pattern: "^[a-f0-9]{64}$" }), patch: Type.Object({ text: Type.Optional(text), title: Type.Optional(title) }, { additionalProperties: false }) }, { additionalProperties: false })),
    tool("canvas_focus", "将用户视图定位到一个已存在的真实节点。", Type.Object({ nodeId: Type.String() }, { additionalProperties: false })),
    tool("user_ask", (matchingV2 ? "仅询问必要缺项：每个field必须包含semantic目的、requirement关联字段、稳定unresolvedId与当前需求revision。缺省/auto/explicit型号和已知参数不重问，普通文字也不得追问型号；保留缺参考、目标歧义、真实冲突、无候选和预算问题。" : "") + "收集影响结果的缺项，优先用fields一次提供关联问题（通常1–4项），界面会逐题展示。支持单选、多选、文字、数字、开关；选择题必须给options，其余字段不填options。可写有依据的推荐理由，推荐不会自动选中。用户可逐题填写补充说明作为自定义回答，无合适选项时不必勾选；返回values及按字段ID对应的notes，也可逐题忽略返回skippedFields或整组skipped；忽略不代表确认。已有信息不要重问，回答后接续任务。仅收集偏好，不能授权付费生成。" + (matchingV2 ? "新问题只使用语义fields。" : "fields与顶层options二选一，后者保留单题兼容。"), Type.Object({ title: Type.String({ minLength: 1, maxLength: 120 }), question: Type.String({ minLength: 1, maxLength: 4000 }), ...(matchingV2 ? { fields: Type.Array(questionField, { minItems: 1, maxItems: 8 }) } : { fields: Type.Optional(Type.Array(questionField, { minItems: 1, maxItems: 8 })), options: Type.Optional(Type.Array(Type.Object({ value: Type.String({ minLength: 1, maxLength: 200 }), label: Type.String({ minLength: 1, maxLength: 300 }) }, { additionalProperties: false }), { minItems: 2, maxItems: 4 })) }) }, { additionalProperties: false })),
    tool("generation_models", run.input.matchingPolicyVersion === 2 ? "按需查看当前可用图片/视频模型与参数。普通生成由系统匹配，不必为每次生成先查目录。用户比较模型或需要专项写法时，再按真实ID读取model_guidance。" : "查看当前可用图片/视频模型、支持参数和专项资料索引。生成前先读取，不得猜测模型ID或参数。模型优劣建议和正式提示词写作前，按真实ID读取model_guidance。", Type.Object({}, { additionalProperties: false })),
    tool("model_guidance", "读取当前可用模型的官方写作建议、适用版本、来源日期和项目检查方法。未知型号返回资料缺项，不编造模型偏好。与本轮已选型号匹配后再使用；运行时参数优先，官方资料不等于本渠道能力或实测排名。", Type.Object({ model: Type.String({ minLength: 1, maxLength: 200 }), mediaType: Type.Union([Type.Literal("image"), Type.Literal("video")]) }, { additionalProperties: false })),
    tool("image_generate", matchingV2 ? "独立图片任务直接传prompt及可选facts/continuation（同generation_requirements合同），一次校验、动态匹配并准确审批，无需先查目录/另建plan。多产物或多步先用完整plan覆盖全部数量，不能按分项单步提交；已有plan仅传actionId/stepId复用收据，显式差异拒绝。model仅建议，固定偏好优先；临时修改须facts，失败修正而非丢弃要求。无候选只澄清冲突，不问型号/读价格。批准后提交，auto/跳过不授权；count为独立调用次数，每次n=1，可能返回多候选。引用须真实固定版本；提交不等于完成。" : "提交图片生成任务。model在明确模型偏好时沿用所选型号；智能匹配模式须先查generation_models按任务和固定参数选可用型号并传model，不能省略；旧未选模式可省略，由工具询问imageModel。固定参数优先；冲突先说明。用户选择后仍会展示准确参数和调用次数等待确认；跳过不生成。count为独立图片调用次数，每次请求n=1，模型可能返回多个候选图；参考图必须来自已读取的画布固定版本。返回提交结果不代表已生成完成。", mediaSchema({ ...mediaBase, params: Type.Optional(Type.Object({ count: Type.Optional(Type.Integer({ minimum: 1, maximum: 4 })), aspectRatio: Type.Optional(Type.String()), resolution: Type.Optional(Type.String()), quality: Type.Optional(Type.String()), background: Type.Optional(Type.String()), ...(matchingV2 ? { gptImage25Mode: Type.Optional(Type.Union([Type.Literal("flare"), Type.Literal("sunburst")])) } : {}) }, { additionalProperties: false })) }, ["prompt"])),
    tool("video_generate", matchingV2 ? "独立视频任务直接传prompt、params.inputMode及可选facts/continuation（同generation_requirements合同），一次校验、动态匹配并准确审批，无需先查目录/另建plan。多产物或多步先用完整plan覆盖全部数量，不能按分项单步提交；已有plan仅传actionId/stepId复用收据，显式差异拒绝。model仅建议，固定偏好优先；临时修改须facts，失败修正而非丢弃要求。inputMode须真实能力，不问型号/读价格。批准后提交1次；auto/跳过不授权。引用须真实固定版本；提交不等于完成。" : "提交1次视频生成任务。model在明确模型偏好时沿用所选型号；智能匹配模式须先查generation_models按任务和固定参数选可用型号并传model，不能省略；旧未选模式可省略，由工具询问videoModel。固定参数优先；冲突先说明。用户选择后准确参数确认才会提交；跳过不生成。参考素材使用真实节点和语义哈希；inputMode与参数必须来自generation_models。返回提交结果不代表视频完成。", mediaSchema({ ...mediaBase, params: optionalForPlan(Type.Object({ inputMode: Type.String(), ratio: Type.Optional(Type.String()), resolution: Type.Optional(Type.String()), duration: Type.Optional(Type.Integer()), generateAudio: Type.Optional(Type.Boolean()), cameraFixed: Type.Optional(Type.Boolean()), watermark: Type.Optional(Type.Boolean()), ...(matchingV2 ? { omniReferenceTaskType: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("edit"), Type.Literal("extend")])), outputFormat: Type.Optional(Type.Union([Type.Literal("mp4"), Type.Literal("mov")])) } : {}), seed: Type.Optional(Type.Integer()) }, { additionalProperties: false })) }, ["prompt", "params"])),
    tool("generation_read", "读取已提交生成任务的真实状态与持久化输出。处理中应告知用户，不得伪称生成完成或反复提交。", Type.Object({ generationId: Type.Integer({ minimum: 1 }) }, { additionalProperties: false })),
  ];
}
