import "server-only";

import { Agent, type AgentMessage, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import { validateToolArguments, type Api, type Model, type ToolResultMessage } from "@earendil-works/pi-ai";
import { assertDurableWorkAdmission, MaintenanceSubmissionError } from "@/lib/maintenance";
import { CreativeAgentError } from "./errors";
import { creativeAgentStore, type CreativeAgentStore } from "./store";
import { hash, HttpError, type Run } from "./store-types";
import { readCreativeAgentAttachments, describeCreativeAgentAttachments } from "./attachments";
import { prepareCreativeAgentReferences } from "./reference-preparation";
import { buildCreativeSystemPrompt } from "./skills";
import { summarizeMediaOutcomes } from "./media-summary";
import { recordCreativeDebug } from "./debug-trace";
import { sanitizeDebugValue } from "./debug-sanitize";
import type { CreativeAgentMedia } from "./contracts";
import { creativeToolPresentation, creativeToolFailurePresentation } from "./tool-presentation";
import { creativeSkillSystemPolicy, expandCreativeSkillCommand, validateExpandedCreativeSkill } from "./skill-packages";
import { newMatchingPreferences } from "./matching-contracts";

export type CreativeAgentRunnerDependencies = {
  store?: CreativeAgentStore;
  model: Model<Api>;
  stream: StreamFn;
  tools: AgentTool[];
  signal?: AbortSignal;
  maxModelCalls?: number;
  readProjectContext?: (run: Run) => Promise<unknown>;
  retryMedia?: (run: Run, action: MediaActionReceipt, failedGenerationId: number, signal?: AbortSignal) => Promise<Record<string, unknown> | null>;
  awaitMedia?: (run: Run, generationIds: number[], signal?: AbortSignal) => Promise<{ pendingGenerationIds: number[]; generations?: Record<string, unknown>[] }>;
  advancePlan?: (run: Run, generations: Record<string, unknown>[]) => Promise<"complete" | "waiting" | "dispatched">;
};

/** Resume only known transcript work. Unknown side effects are rejected by the store/tool receipts. */
type PendingToolCall = { id: string; name: string; arguments: Record<string, unknown> };
type RejectedToolObserver = (call: PendingToolCall, code: string, message: string, phase?: string) => Promise<void>;
export async function repairPendingToolResults(messages: AgentMessage[], tools: AgentTool[], signal?: AbortSignal, executePending = true, onRejected?: RejectedToolObserver, checkpoint?: (messages: AgentMessage[]) => Promise<void>): Promise<AgentMessage[]> {
  const restored = [...messages];
  let mediaCancelled = executePending && cancelledMediaTurn(restored);
  const pending = new Map<string, { id: string; name: string; arguments: Record<string, unknown> }>();
  for (const message of restored) {
    if (message.role === "assistant") for (const part of message.content) if (part.type === "toolCall") pending.set(part.id, part);
    if (message.role === "toolResult") pending.delete(message.toolCallId);
  }
  for (const call of pending.values()) {
    signal?.throwIfAborted();
    const tool = tools.find(item => item.name === call.name);
    if (executePending && !mediaCancelled && !tool) {
      const error = new CreativeAgentError("TOOL_UNAVAILABLE", `恢复所需工具 ${call.name} 当前不可用`);
      await onRejected?.(call,error.code,error.message);
      throw error;
    }
    let validated: Record<string, unknown> | undefined;
    if (executePending && !mediaCancelled) {
      try { validated = validateToolArguments(tool!, { type: "toolCall", ...call }); }
      catch (error) { await onRejected?.(call,"invalid_tool_arguments",error instanceof Error ? error.message : "工具参数校验未通过"); throw error; }
    }
    // The assistant tool call was committed before dispatch. The tool's durable receipt
    // decides whether this is a never-dispatched call, a replayable result, or unknown.
    const result = mediaCancelled
      ? { content: [{ type: "text" as const, text: "用户已取消本轮媒体准备，此工具不再继续执行；先前执行情况以持久记录为准，不能据此认定成功或失败。" }], details: {} }
      : executePending
      ? await tool!.execute(call.id, validated!, signal)
      : { content: [{ type: "text" as const, text: "上一轮工具调用未返回完整结果。续接前请核对恢复记录和画布中的实际结果；此记录不表示操作失败或成功，不得据此重复执行。" }], details: {} };
    const message: ToolResultMessage = { role: "toolResult", toolCallId: call.id, toolName: call.name, content: result.content, details: result.details, isError: !executePending || mediaCancelled, timestamp: Date.now() };
    restored.push(message);
    // A later pending call can change the run's subject/defaults. Commit this
    // result first; a failed write must stop the batch before that next call.
    await checkpoint?.([...restored]);
    if (!message.isError && ["image_generate", "video_generate"].includes(call.name) && explicitMediaCancellation(result.details)) mediaCancelled = true;
  }
  return restored;
}

type MediaActionReceipt = { id: string; kind: string; state: string; result?: Record<string, any> };
type MediaObservationDependencies = Pick<CreativeAgentRunnerDependencies, "store" | "signal" | "awaitMedia" | "retryMedia" | "advancePlan">;

async function finishOrDeferMedia(run: Run, dependencies: MediaObservationDependencies): Promise<void> {
  const store = dependencies.store ?? creativeAgentStore;
  let observed: Record<string, unknown>[] = [];
  const actions = await store.actionReceipts(run.id) as MediaActionReceipt[];
  const mediaActions = actions.filter(action => ["image.generate", "video.generate"].includes(action.kind));
  const mediaCancelled = mediaActions.some(action => action.state === "succeeded" && explicitMediaCancellation({ result: action.result }));
  const interruptedRetry = mediaActions.find(action => action.result?.retryOfGenerationId && action.state !== "succeeded");
  if (interruptedRetry) throw new CreativeAgentError(interruptedRetry.state === "failed" ? "MEDIA_RETRY_NOT_SUBMITTED" : "MEDIA_DISPATCH_UNKNOWN", interruptedRetry.state === "failed" ? String(interruptedRetry.result?.message || "补试未提交") : "补试提交结果尚未确认，已保留结果查询记录，不会重复提交。");
  const replaced = new Set(mediaActions.flatMap(action => typeof action.result?.retryOfGenerationId === "number" ? [action.result.retryOfGenerationId] : []));
  const actionIds = (action: MediaActionReceipt): number[] => (Array.isArray(action.result?.generationIds) ? action.result.generationIds : typeof action.result?.generationId === "number" ? [action.result.generationId] : []).filter((id: unknown): id is number => Number.isSafeInteger(id) && Number(id) > 0);
  const generationIds = [...new Set(mediaActions.filter(action => action.state === "succeeded").flatMap(actionIds))].filter(id => !replaced.has(id));
  const withRetry = (receipt: Record<string, unknown>) => {
    const retry = mediaActions.find(action => action.result?.retryOfGenerationId && actionIds(action).includes(Number(receipt.generationId)))?.result;
    return retry ? { ...receipt, retryOfGenerationId: retry.retryOfGenerationId, retryAttempt: 1, retryReason: retry.retryReason } : receipt;
  };
  if (generationIds.length) {
    await store.waitForActions(run.id, run.epoch);
    let pendingGenerationIds: number[] = [], generations: Record<string, unknown>[] | undefined;
    let failedObservation: CreativeAgentError | undefined;
    const saveSummary = async (receipts: Record<string, unknown>[] | undefined) => {
      const summary = summarizeMediaOutcomes((receipts || []) as CreativeAgentMedia[]);
      if (summary) await store.saveAssistant(run.id, run.epoch, `${run.id}:media:completed`, summary);
    };
    try {
      if (dependencies.awaitMedia) ({ pendingGenerationIds, generations } = await dependencies.awaitMedia(run, generationIds, dependencies.signal));
      else {
        const { waitForCreativeAgentMedia } = await import("./media-broker");
        ({ pendingGenerationIds, generations } = await waitForCreativeAgentMedia({ actorUserId: run.actorUserId, canvasId: run.canvasId, runId: run.id, epoch: run.epoch, signal: dependencies.signal }, {
          generationIds, pollOnce: true,
          onProgress: async receipt => { await store.publishMedia(run, withRetry(receipt)); },
          onCommitted: async (commit: { generationId: number; revision: string; nodeIds: string[] }) => { await store.commitGenerationEvent(run.id, run.epoch, commit); },
        }));
      }
    } catch (error) {
      if (!(error instanceof CreativeAgentError) || error.code !== "MEDIA_GENERATION_FAILED") throw error;
      failedObservation = error;
      generations = (error as CreativeAgentError & { generations?: Record<string, unknown>[] }).generations;
    }
    generations = generations?.map(withRetry);
    if (run.input.matchingPolicyVersion === 2 && generations?.some(item => item.outputMismatch === true)) {
      await saveSummary(generations);
      throw new CreativeAgentError("OUTPUT_CONTRACT_MISMATCH", "实际产物超出约定，已保留全部结果并停止后续生成与补试。");
    }
    for (const failed of generations || []) {
      if (mediaCancelled) break;
      if (failed.status !== "failed" || failed.retryOfGenerationId) continue;
      const parent = mediaActions.find(action => action.state === "succeeded" && !action.result?.retryOfGenerationId && actionIds(action).includes(Number(failed.generationId)));
      if (!parent?.result?.mediaRequest) continue; // Old approvals never acquire a retry budget.
      dependencies.signal?.throwIfAborted(); await store.assertFence(run.id, run.epoch);
      const retry = dependencies.retryMedia
        ? await dependencies.retryMedia(run, parent, Number(failed.generationId), dependencies.signal)
        : await (await import("./media-broker")).executeCreativeAgentMediaRetry({ actorUserId: run.actorUserId, canvasId: run.canvasId, runId: run.id, epoch: run.epoch, actionId: parent.id, kind: parent.kind, args: parent.result.mediaRequest.args, signal: dependencies.signal }, Number(failed.generationId));
      if (!retry) continue;
      await store.publishMedia?.(run, retry);
      await store.saveAssistant(run.id, run.epoch, `${run.id}:media:retry:${failed.generationId}`, `生成失败：${String(retry.retryReason || failed.error || "服务未返回具体原因")}。已按确认的预算自动补试 1 次，成功素材保持不变。`);
      generations = generations!.map(item => item === failed ? retry : item);
      if (!["success", "failed", "cancelled", "canceled"].includes(String(retry.status))) pendingGenerationIds.push(Number(retry.generationId));
    }
    if (pendingGenerationIds.length) { await store.defer(run.id, run.epoch, "waiting_action"); return; }
    dependencies.signal?.throwIfAborted();
    await store.assertFence(run.id, run.epoch);
    await saveSummary(generations);
    observed = generations ?? [];
    if (generations?.some(item => ["failed", "cancelled", "canceled"].includes(String(item.status))) || failedObservation && !generations?.length) throw failedObservation || new CreativeAgentError("MEDIA_GENERATION_FAILED", "本次有生成任务失败或取消，已保留其他完成的画布结果");
  }
  if (mediaCancelled) {
    await store.saveAssistant(run.id, run.epoch, `${run.id}:media:cancelled`, "已取消本次生成准备，未继续提交后续任务。");
  } else if (run.input.matchingPolicyVersion === 2) {
    try {
      const progress = dependencies.advancePlan ? await dependencies.advancePlan(run, observed) : await (await import("./plan-runtime")).advancePersistedPlan(run, observed, { store, signal: dependencies.signal });
      if (progress !== "complete") { await store.defer(run.id, run.epoch, "waiting_action"); return; }
    } catch (error) {
      if (error instanceof HttpError && error.code === "run_deferred") return;
      throw error;
    }
  }
  await store.finish(run.id, run.epoch, "completed");
}

/** A submitted batch is a durable hand-off; waiting does not need another model turn. */
function completedMediaBatch(messages: AgentMessage[], userTimestamp: number) {
  const userIndex = messages.findLastIndex(message => message.role === "user" && message.timestamp === userTimestamp);
  const index = messages.findLastIndex(message => message.role === "assistant");
  if (userIndex < 0 || index <= userIndex) return false;
  const assistant = messages[index];
  if (assistant?.role !== "assistant") return false;
  const calls = assistant.content.filter(part => part.type === "toolCall");
  const results = messages.slice(index + 1).filter(message => message.role === "toolResult");
  return calls.length > 0 && calls.every(call => results.some(result => result.toolCallId === call.id && !result.isError))
    && results.some(result => ["image_generate", "video_generate"].includes(result.toolName) && submittedMedia(result.details));
}
function submittedMedia(details: unknown) {
  const result = (details as { result?: { generationIds?: unknown[]; generationId?: number } } | undefined)?.result;
  return Boolean(result && (result.generationIds?.length || result.generationId));
}

const MEDIA_PREPARATION_CANCELLED = "用户已取消本轮媒体准备，未再调用模型。";
function explicitMediaCancellation(details: unknown) {
  const result = (details as { result?: { cancelled?: unknown; revisionRequested?: unknown; skipped?: unknown } } | undefined)?.result;
  return result?.cancelled === true && result.revisionRequested !== true && result.skipped !== true && !submittedMedia(details);
}
function cancelledMediaTurn(messages: AgentMessage[], userTimestamp?: number) {
  const start = messages.findLastIndex(message => message.role === "user" && (userTimestamp === undefined || message.timestamp === userTimestamp));
  if (userTimestamp !== undefined && start < 0) return false;
  return messages.slice(start + 1).some(message => message.role === "toolResult" && !message.isError && ["image_generate", "video_generate"].includes(message.toolName) && explicitMediaCancellation(message.details));
}

/** A previously completed model turn can observe paid tasks without any chat route. */
export async function resumeCompletedCreativeAgentTurn(run: Run, dependencies: MediaObservationDependencies = {}): Promise<boolean> {
  const store = dependencies.store ?? creativeAgentStore;
  const messages = await store.getTranscript(run.sessionId) as AgentMessage[];
  const last = messages.at(-1);
  if (!messages.some(message => message.role === "user" && message.timestamp === Date.parse(run.createdAt)) || !(last?.role === "assistant" && last.stopReason === "stop") && !completedMediaBatch(messages, Date.parse(run.createdAt)) && !cancelledMediaTurn(messages, Date.parse(run.createdAt))) return false;
  dependencies.signal?.throwIfAborted();
  await store.assertFence(run.id, run.epoch);
  await assertDurableWorkAdmission();
  await finishOrDeferMedia(run, dependencies);
  return true;
}

export async function runCreativeAgent(run: Run, dependencies: CreativeAgentRunnerDependencies): Promise<void> {
  const store = dependencies.store ?? creativeAgentStore;
  let agent: Agent | undefined;
  let modelFailure: string | null = null;
  let messageId = "";
  let assistantIndex = 0;
  let modelCalls = 0;
  let toolCalls = 0;
  let mediaCancelled = false;
  let eventWrites: Promise<void> = Promise.resolve();
  let eventFailure: unknown;
  let deltaTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingText = "", pendingThinking = "", thinkingContent = "";
  let thinkingStarted = 0, thinkingDuration = 0;
  const enqueueEvent = (write: () => Promise<unknown>) => {
    eventWrites = eventWrites.then(async () => { if (!eventFailure) await write(); }).catch(error => { eventFailure = error; agent?.abort(); });
  };
  const flushDeltas = () => {
    clearTimeout(deltaTimer); deltaTimer = undefined;
    const id = messageId;
    if (pendingThinking) {
      const delta = pendingThinking; pendingThinking = "";
      const duration = thinkingDuration + (thinkingStarted ? (performance.now() - thinkingStarted) / 1000 : 0);
      enqueueEvent(() => store.appendEvent(run.id, run.epoch, "thinking.delta", { messageId: id, delta, duration }));
    }
    if (pendingText) { const delta = pendingText; pendingText = ""; enqueueEvent(() => store.appendEvent(run.id, run.epoch, "text.delta", { messageId: id, delta })); }
  };
  const finishThinking = () => {
    if (!thinkingStarted) return;
    flushDeltas();
    thinkingDuration += (performance.now() - thinkingStarted) / 1000; thinkingStarted = 0;
    const id = messageId, content = thinkingContent, duration = thinkingDuration;
    enqueueEvent(() => store.appendEvent(run.id, run.epoch, "thinking.completed", { messageId: id, content, duration }));
  };
  const drainEvents = async () => { flushDeltas(); await eventWrites; if (eventFailure) throw eventFailure; };
  const validatedCalls = new Set<string>(), rejectedCalls = new Set<string>();
  const recordRejected: RejectedToolObserver = async (call, code, message, phase = "preflight") => {
    if (rejectedCalls.has(call.id)) return;
    rejectedCalls.add(call.id);
    const actionId = `ca_sdk_${hash({runId:run.id,revision:run.input.revision??0,toolCallId:call.id})}`;
    const name = call.name.replace("_", ".");
    const detail: Record<string, unknown> = { status:"error", phase, dispatched:false, code, message:String(sanitizeDebugValue(message)).slice(0,4000) };
    if (["image.generate", "video.generate"].includes(name)) {
      try {
        const receipts = (await store.actionReceipts(run.id)).filter(action => action.kind === name);
        if (receipts.some(action => action.state === "unknown" || action.state === "claimed")) { delete detail.dispatched; detail.receiptState = "unknown"; }
        else if (receipts.some(action => action.result?.mediaDispatch || action.result?.generationId || action.result?.generationIds?.length)) { delete detail.dispatched; detail.phase = "validation"; }
      } catch { delete detail.dispatched; detail.receiptState = "unknown"; }
    }
    const presentation = creativeToolFailurePresentation(name,detail);
    const title = presentation?.title || "工具调用准备";
    recordCreativeDebug({spanId:actionId,eventKey:actionId,category:"tool",type:"tool.failed",title:`${title} · ${presentation?.outcomeLabel || "未完成"}`,status:"error",summary:{actionId,toolCallId:call.id,tool:name},detail});
    await store.appendEvent(run.id,run.epoch,"tool.completed",{actionId,toolCallId:call.id,name,title,status:"error",detail}).catch(()=>undefined);
  };
  const abort = () => agent?.abort();
  dependencies.signal?.addEventListener("abort", abort, { once: true });
  try {
    dependencies.signal?.throwIfAborted();
    await store.assertFence(run.id, run.epoch);
    let currentAttachmentContext = "";
    let preparedAttachments: import("./attachments").CreativeAgentAttachmentRecord[] | undefined;
    if (run.input.attachments?.length) {
      const prepared = await prepareCreativeAgentReferences(run, undefined, dependencies.signal, records => { preparedAttachments = records; });
      dependencies.signal?.throwIfAborted();
      await store.assertFence(run.id, run.epoch);
      run = await store.savePreparedReferences(run.id, run.epoch, prepared.selection, prepared.revision);
      const attachments = await describeCreativeAgentAttachments({ actorUserId: run.actorUserId, canvasId: run.canvasId, sessionId: run.sessionId, attachments: run.input.attachments });
      currentAttachmentContext = "本轮附件到画布节点的已验证映射：不同附件标签可以指向同一个已验证节点；去重只减少节点及生成引用，不表示附件缺失。按以下每个附件id/name/reference确认映射，不得按标签数量、文件名或(2)后缀推定未映射或内容相同；文件名不是内容身份，也不能代替权限或版本校验。\n" + JSON.stringify(attachments);
    }
    const referenceHistory = run.input.conversationContext ? "" : await store.getReferenceHistory?.(run) || "";
    let messages = await store.getTranscript(run.sessionId) as AgentMessage[];
    const timestamp = Date.parse(run.createdAt);
    const hasInput = messages.some(message => message.role === "user" && message.timestamp === timestamp);
    if (hasInput && run.input.conversationContext?.skillId) {
      const current = messages.find(message => message.role === "user" && message.timestamp === timestamp)!;
      const text = current.role === "user" ? typeof current.content === "string" ? current.content : current.content.filter(part => part.type === "text").map(part => part.text).join("\n") : "";
      if (!text.startsWith("用户为本轮选择了以下技能。")) throw new CreativeAgentError("SKILL_UNAVAILABLE", "本轮技能读取记录不完整，请重新选择后继续。", 409);
      // Revalidate before repairing a pending tool, which may dispatch without a model turn.
      await validateExpandedCreativeSkill(text, run.actorUserId);
    }
    messages = await repairPendingToolResults(messages, dependencies.tools, dependencies.signal, hasInput, recordRejected, restored => store.saveTranscript(run.id, run.epoch, restored));
    await store.saveTranscript(run.id, run.epoch, messages);
    if (hasInput && (completedMediaBatch(messages, timestamp) || cancelledMediaTurn(messages, timestamp))) {
      await finishOrDeferMedia(run, dependencies);
      return;
    }
    const recoveryContext = await store.getRecoveryContext(run);
    let projectContext: unknown;
    agent = new Agent({
      // The provider-aware stream maps run.input.thinkingLevel; do not let SDK presets override it.
      initialState: { model: dependencies.model, systemPrompt: [buildCreativeSystemPrompt(run), recoveryContext, referenceHistory, currentAttachmentContext].filter(Boolean).join("\n\n"), messages, tools: dependencies.tools, thinkingLevel: "off" },
      sessionId: run.sessionId,
      toolExecution: "sequential",
      streamFn: async (model, context, options) => {
        // The SDK's batch terminate requires every result to opt in. An earlier
        // invalid/failed tool must not reopen a provider call after cancellation.
        if (mediaCancelled) throw new CreativeAgentError("MEDIA_PREPARATION_CANCELLED", MEDIA_PREPARATION_CANCELLED);
        await assertDurableWorkAdmission();
        const current = await store.assertFence(run.id, run.epoch);
        if (current) run = { ...current, input: { ...current.input, ...(current.input.preparedSelection ? { selection: current.input.preparedSelection, baseRevision: run.input.baseRevision } : {}) } };
        const currentReferenceContext = run.input.conversationContext ? await store.getReferenceHistory?.(run) || "" : referenceHistory;
        const user = context.messages.find(message => message.role === "user" && message.timestamp === timestamp);
        let loadedSkill = false;
        if (user?.role === "user") {
          const text = typeof user.content === "string" ? user.content : user.content.filter(p => p.type === "text").map(p => p.text).join("\n");
          if (text.startsWith("用户为本轮选择了以下技能。")) {
            await validateExpandedCreativeSkill(text, run.actorUserId);
            loadedSkill = true;
          }
        }
        if (!loadedSkill && run.input.matchingPolicyVersion === 2 && user && context.messages.slice(context.messages.indexOf(user) + 1).some(message => message.role === "toolResult" && message.toolName === "skillOperator" && !message.isError)) {
          // Only the current run's successful authorized read can supply a document.
          // Lists, failed reads, prose mentions and previous-run history do not qualify.
          loadedSkill = (await store.actionReceipts(run.id)).some(action => action.kind === "skillOperator" && action.state === "succeeded" && typeof action.result?.content === "string" && /^(system|personal):[1-9]\d*$/.test(String(action.result.id)) && Number.isSafeInteger(action.result.revision) && action.result.revision > 0);
        }
        const selectedSkillPolicy = loadedSkill && run.input.matchingPolicyVersion === 2 ? `${creativeSkillSystemPolicy(run.input.mediaAuthorizationVersion)}\n本轮当前有效模型偏好：${JSON.stringify(newMatchingPreferences(run.input.effectivePreferences ?? run.input.preferences))}` : "";
        if (dependencies.readProjectContext) {
          const preparationStarted = performance.now();
          projectContext = await dependencies.readProjectContext(run);
          await store.appendEvent(run.id, run.epoch, "run.status", { status: "running", preparation: { kind: "project-context", status: "completed", elapsedMs: Math.round(performance.now() - preparationStarted) } });
        }
        if (++modelCalls > (dependencies.maxModelCalls ?? 20)) throw new CreativeAgentError("MODEL_CALL_LIMIT", "本轮已达到模型调用上限，已保留当前成果。");
        return dependencies.stream(model, { ...context, systemPrompt: [buildCreativeSystemPrompt(run, loadedSkill), recoveryContext, currentReferenceContext, currentAttachmentContext, projectContext ? `历史项目参考快照（仅在本轮明确相关或续作时使用；本轮要求与当前偏好优先，不将旧任务条件自动带入新独立任务）：\n${JSON.stringify(projectContext)}` : "", selectedSkillPolicy].filter(Boolean).join("\n\n") }, { ...options, maxRetries: 0 });
      },
      afterToolCall: async ({ toolCall, result, isError, context }) => {
        if (isError) return;
        const mediaCall = ["image_generate", "video_generate"].includes(toolCall.name);
        if (mediaCall && explicitMediaCancellation(result.details)) {
          mediaCancelled = true;
          return { terminate: true };
        }
        if (mediaCall && !submittedMedia(result.details)) return;
        const lastAssistant = [...context.messages].reverse().find(message => message.role === "assistant");
        if (lastAssistant?.role === "assistant" && lastAssistant.content.some(part => part.type === "toolCall" && ["image_generate", "video_generate"].includes(part.name))) return { terminate: true };
      },
      beforeToolCall: async ({toolCall}) => {
        validatedCalls.add(toolCall.id);
        if (mediaCancelled) return { block: true, reason: "用户已取消本轮媒体准备，不再执行后续工具。" };
        try { await drainEvents(); await store.assertFence(run.id, run.epoch); }
        catch (error) { await recordRejected(toolCall,error instanceof HttpError || error instanceof CreativeAgentError ? error.code : "tool_admission_blocked",error instanceof Error ? error.message : "工具执行条件未通过","admission"); throw error; }
        if (++toolCalls > 100) { await recordRejected(toolCall,"TOOL_CALL_LIMIT","本轮工具调用已达到上限。","admission"); return { block: true, reason: "本轮工具调用已达到上限。" }; }
      },
    });
    agent.subscribe(event => {
      if (event.type === "tool_execution_end" && event.isError && !validatedCalls.has(event.toolCallId)) {
        const calls = agent!.state.messages.flatMap(message => message.role === "assistant" ? message.content.filter(part => part.type === "toolCall") : []);
        const call = calls.findLast(call => call.id === event.toolCallId);
        const tool = dependencies.tools.find(tool => tool.name === event.toolName);
        if (call) {
          if (!tool) enqueueEvent(()=>recordRejected(call,"TOOL_UNAVAILABLE","本轮没有提供该工具。"));
          else {
            // Only a reproducible schema failure identifies the SDK immediate path.
            // Executor errors have passed beforeToolCall and already own their activity.
            try { validateToolArguments(tool,structuredClone(call)); }
            catch (error) { enqueueEvent(()=>recordRejected(call,"invalid_tool_arguments",error instanceof Error ? error.message : "工具参数校验未通过")); }
          }
        }
      }
      if (event.type === "message_start" && event.message.role === "assistant") {
        flushDeltas(); messageId = `${run.id}:a:${run.epoch}:${++assistantIndex}`;
        thinkingContent = ""; thinkingDuration = 0; thinkingStarted = 0;
      }
      if (event.type === "message_update") {
        const part = event.assistantMessageEvent;
        if (part.type === "thinking_delta") {
          if (!thinkingStarted) thinkingStarted = performance.now();
          pendingThinking += part.delta; thinkingContent += part.delta;
        } else if (part.type === "text_delta") { finishThinking(); pendingText += part.delta; }
        else if (part.type === "thinking_end") finishThinking();
        if ((pendingThinking || pendingText) && !deltaTimer) deltaTimer = setTimeout(flushDeltas, 50);
      }
      if (event.type === "message_end") {
        // The SDK turns our local stop into an empty assistant error. It is not
        // a provider failure or a conversation message; the tool receipt is durable.
        if (mediaCancelled && event.message.role === "assistant" && event.message.stopReason === "error" && event.message.errorMessage === MEDIA_PREPARATION_CANCELLED) return;
        finishThinking(); flushDeltas();
        const transcript = structuredClone(agent!.state.messages);
        enqueueEvent(() => store.saveTranscript(run.id, run.epoch, transcript));
        if (event.message.role === "assistant") {
          const text = event.message.content.filter(part => part.type === "text").map(part => part.text).join("");
          const content = event.message.content.filter(part => part.type === "thinking").map(part => part.thinking).join("");
          const id = messageId;
          const thinking = content ? { content, ...(thinkingDuration ? { duration: thinkingDuration } : {}), streaming: false } : undefined;
          if (text || thinking) enqueueEvent(() => store.saveAssistant(run.id, run.epoch, id, text, thinking));
          if (event.message.stopReason === "error") modelFailure = event.message.errorMessage || "对话模型请求失败，本轮未完成。";
          if (event.message.stopReason === "aborted") modelFailure = "模型请求已中断，本轮未完成。";
          if (event.message.stopReason === "length") modelFailure = "模型输出达到长度上限，请检查已保存内容后继续。";
        }
      }
    });
    if (!hasInput) {
      const attachmentParts = await readCreativeAgentAttachments({ ...run.input, sessionId: run.sessionId }, dependencies.model.input.includes("image"), preparedAttachments);
      const prompt = await expandCreativeSkillCommand(run.input.text, run.actorUserId, async event => {
        const actionId = `skill-input:${run.id}:${run.input.revision ?? 0}`;
        await store.appendEvent(run.id,run.epoch,event.status === "running" ? "tool.started" : "tool.completed", {actionId,name:"skillOperator",title:event.activity.name ? `技能 · ${event.activity.name}` : "加载所选技能",status:event.status,activity:event.activity,...(event.status !== "running" ? {detail:event.status === "error" ? {status:"error",activity:event.activity,message:event.message} : creativeToolPresentation("skillOperator",{activity:event.activity})} : {})});
      }, run.input.matchingPolicyVersion, run.input.mediaAuthorizationVersion, run.input.conversationContext?.skillId);
      await agent.prompt({ role: "user", content: attachmentParts.length ? [{ type: "text", text: `${prompt}\n\n已准备的本轮画布引用：${JSON.stringify(run.input.selection.references)}` }, ...attachmentParts] : prompt, timestamp });
    }
    else if (messages.at(-1)?.role === "user" || messages.at(-1)?.role === "toolResult") await agent.continue();
    else if (messages.at(-1)?.role === "assistant") {
      const last = messages.at(-1)!;
      if (last.role === "assistant" && last.stopReason !== "stop") throw new CreativeAgentError("INCOMPLETE_TRANSCRIPT", "上一轮模型输出不完整，不能自动重放。请停止后发送新消息。");
    } else throw new CreativeAgentError("INVALID_TRANSCRIPT", "对话恢复点无效。");
    dependencies.signal?.throwIfAborted();
    await drainEvents();
    // pi can convert a tool/stream exception into an error message. Recheck the
    // admission gate here so maintenance pauses the durable run at this safe point.
    await assertDurableWorkAdmission();
    if (modelFailure) throw new CreativeAgentError("MODEL_INCOMPLETE", modelFailure);
    await finishOrDeferMedia(run, dependencies);
  } catch (error) {
    finishThinking(); flushDeltas(); await eventWrites;
    const current = await store.getRun(run.id).catch(() => null);
    if (current && current.epoch !== run.epoch && !current.workerId && ["waiting_decision", "waiting_action"].includes(current.status)) return;
    if (error instanceof MaintenanceSubmissionError) {
      await store.control(run.id, run.actorUserId, `maintenance:${run.id}:${run.epoch}`, "pause", run.epoch).catch(() => undefined);
      throw error;
    }
    const message = error instanceof CreativeAgentError || error instanceof HttpError ? error.message : "Agent 执行中断，已保存已确认的成果。";
    await store.finish(run.id, run.epoch, "failed", message);
    throw error;
  } finally {
    clearTimeout(deltaTimer);
    await eventWrites;
    dependencies.signal?.removeEventListener("abort", abort);
    agent?.abort();
  }
}
