import "server-only";
import { projectLlmUsage, type CreativeLlmAttempt } from "./call-metrics";
import { windowCreativeMessages } from "./context-window";

import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Api, type StreamFunction } from "@earendil-works/pi-ai";
import prisma from "@/lib/prisma";
import { resolveCreativeAgentModel, creativeAgentSupportsVision } from "./model-catalog";
import type { CreativeAgentInputOptions } from "./contracts";
import { openAiChatAdapter, buildOpenAiChatBody } from "@/lib/llm-routing/adapters/openai-chat";
import { isBigModelGlm53 } from "@/lib/bigmodel-llm-models";
import { fetchWithProviderEgress } from "@/lib/providers/transport";
import { beginLlmCost, finishLlmCost } from "@/lib/billing/llm";
import { assertDurableWorkAdmission } from "@/lib/maintenance";
import type { LlmUsage } from "@/lib/llm-routing/types";
import { creativeAgentStore } from "./store";
import { hash, modelFrontierHash, HttpError, type ModelFrontier } from "./store-types";
import { creativeAgentStableId } from "./canvas-tools";
import { requireCreativeAgentCanvas } from "./access";
import { CreativeAgentError } from "./errors";
import { creativeAgentChatMessages, readCreativeAgentChatResponse } from "./llm-stream";
import type { CreativeAgentUsageMetadata } from "./usage";
import { newDebugSpan, recordCreativeDebug, rememberDebugSecrets, setDebugModelSpan, withDebugSpan } from "./debug-trace";

type ModelScope = { actorUserId: number; canvasId: number; runId: string; epoch: number; options?: CreativeAgentInputOptions };

export async function createCreativeAgentModelStream(scope: ModelScope): Promise<{ model: Model<Api>; stream: StreamFunction }> {
  const resolved = await resolveCreativeAgentModel(scope.options?.model).catch(() => ({ status: "model-disabled" as const }));
  const executable = resolved.status === "ready" && resolved.route.protocol === "openai-chat" && resolved.route.egressDecision?.providerId === resolved.route.providerId;
  const selected = scope.options?.model;
  // A hidden route may still own a durable receipt. Resolve that frontier before
  // checking eligibility for a new dispatch; unknown receipts must stay blocked.
  if (!executable) {
    const receipts = selected ? await creativeAgentStore.actionReceipts(scope.runId) : [];
    const replayable = receipts.some(action => action.kind === "model.chat");
    if (!replayable) throw new CreativeAgentError(resolved.status === "ready" ? "MODEL_PROTOCOL_UNSUPPORTED" : "MODEL_UNAVAILABLE", "Agent 对话模型尚未就绪", 503);
  }
  const route = executable && resolved.status === "ready" ? resolved.route : undefined;
  const identity = route ?? { ...selected!, protocol: "openai-chat" as const, scenarioId: "agent.chat" as const };
  const model: Model<Api> = {
    id: identity.modelId, name: identity.modelId, provider: identity.providerId, api: "openai-completions",
    baseUrl: "http://internal.invalid", reasoning: false, input: creativeAgentSupportsVision(identity.providerId, identity.modelId) ? ["text", "image"] : ["text"], contextWindow: 128000, maxTokens: 8192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  };
  const stream: StreamFunction = (_model, context, options) => {
    const debugSpan = newDebugSpan("model");
    const debugStarted = performance.now();
    const startedAt = new Date().toISOString();
    let debugFirstOutput: number | undefined;
    let debugPackets: unknown[] = [];
    let debugTimer: ReturnType<typeof setTimeout> | undefined;
    const flushDebugPackets = () => {
      clearTimeout(debugTimer); debugTimer = undefined;
      if (!debugPackets.length) return;
      const packets = debugPackets; debugPackets = [];
      recordCreativeDebug({ spanId: debugSpan, category: "model", type: "model.response.delta", title: "模型正在返回内容", status: "running", summary: { packetCount: packets.length, elapsedMs: Math.round(performance.now() - debugStarted) }, detail: { packets } });
    };
    setDebugModelSpan(debugSpan);
    if (route) rememberDebugSecrets([route.apiKey]);
    const output = createAssistantMessageEventStream();
    let partial: AssistantMessage & { creativeUsage?: CreativeAgentUsageMetadata; creativeEncryptedContent?: string; creativeReasoningDetails?: Record<string, unknown>[] } = {
      role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "stop", timestamp: Date.now(),
      creativeUsage: { reported: false, cacheReported: false },
    };
    void (async () => {
      let actionId: string | undefined;
      let claimed = false, dispatched = false, accepted = false, settled = false, rejected = false;
      let billing: Awaited<ReturnType<typeof beginLlmCost>> | undefined;
      let usage: LlmUsage | null | undefined;
      let attempt: CreativeLlmAttempt | undefined;
      const syncUsage = () => {
        partial.usage = { ...partial.usage, input: Math.max(0, (usage?.inputTokens ?? 0) - (usage?.cachedInputTokens ?? 0)), output: usage?.outputTokens ?? 0, cacheRead: usage?.cachedInputTokens ?? 0, cacheWrite: usage?.cacheCreationInputTokens ?? 0, totalTokens: usage?.totalTokens ?? 0 };
        partial.creativeUsage = { ...partial.creativeUsage, reported: usage?.inputTokens != null && usage?.outputTokens != null, cacheReported: usage?.cachedInputTokens != null, callId: actionId, providerUsage: projectLlmUsage(usage), ...(usage?.reasoningOutputTokens != null ? { reasoningOutputTokens: usage.reasoningOutputTokens } : {}) };
        if (attempt) attempt.usage = projectLlmUsage(usage);
      };
      let timeoutMs = route?.timeoutMs ?? 60_000;
      const idleController = new AbortController();
      let idleTimer: ReturnType<typeof setTimeout> | undefined;
      const resetIdleTimeout = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => idleController.abort(new DOMException("Model stream idle timeout", "TimeoutError")), timeoutMs);
        idleTimer.unref?.();
      };
      try {
        const run = await creativeAgentStore.assertFence(scope.runId, scope.epoch);
        if (run.actorUserId !== scope.actorUserId || run.canvasId !== scope.canvasId) throw new CreativeAgentError("RUN_SCOPE_INVALID", "任务范围无效", 403);
        await requireCreativeAgentCanvas(scope.actorUserId, scope.canvasId, true);
        await assertDurableWorkAdmission();
        options?.signal?.throwIfAborted();
        if (!model.input.includes("image") && context.messages.some(message => (message.role === "user" || message.role === "toolResult") && Array.isArray(message.content) && message.content.some(part => part.type === "image"))) throw new CreativeAgentError("MODEL_VISION_UNSUPPORTED", "当前对话含图片，请选择支持视觉输入的模型", 400);
        const beforeWindow = creativeAgentChatMessages(context, identity);
        const messages = windowCreativeMessages(beforeWindow, undefined, Boolean(run.input.conversationContext));
        const tools = context.tools?.map(tool => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
        const body = { ...buildOpenAiChatBody(identity, [], { tokens: Math.min(options?.maxTokens || 8192, 8192), parameter: "max_tokens" }, true, scope.options?.thinkingLevel), messages, ...(tools?.length ? { tools, tool_choice: "auto", ...(isBigModelGlm53(identity.providerId, identity.modelId) ? {} : { parallel_tool_calls: false }) } : {}) };
        // The old planner's JSON response mode is not compatible with native tool calls.
        delete body.response_format;
        if (Buffer.byteLength(JSON.stringify(body)) > 6_500_000) throw new CreativeAgentError("MODEL_CONTEXT_LIMIT", "本轮上下文已过长，请保存当前成果后开启下一轮");
        const inputHash = hash({ provider: identity.providerId, model: identity.modelId, body });
        recordCreativeDebug({ spanId: debugSpan, category: "model", type: "model.prepared", title: `请求模型 · ${identity.modelId}`, status: "running", summary: { providerId: identity.providerId, modelId: identity.modelId, protocol: identity.protocol, messages: messages.length, beforeWindow: beforeWindow.length, contextWindowed: messages.some(item => item.role === "system" && typeof item.content === "string" && item.content.startsWith("较早的 ")), tools: tools?.length ?? 0 }, detail: { selectedModel: scope.options?.model ?? null, resolved: { providerId: identity.providerId, modelId: identity.modelId, protocol: identity.protocol }, url: route?.url, method: "POST", body, context: { before: beforeWindow.map((item, index) => ({ index, role: item.role, characters: JSON.stringify(item).length })), sentMessages: messages.length, policy: "保留完整轮次；本视图 body 是裁剪后的实际发送内容" }, inputHash } });
        // Host system prompts/tool schemas may change on restart. The complete
        // ordered conversation (before windowing) is the durable execution point.
        const sequence = context.messages.map(message => {
          if (message.role === "user") return { role: message.role, content: message.content, timestamp: message.timestamp };
          if (message.role === "toolResult") return { role: message.role, toolCallId: message.toolCallId, toolName: message.toolName, content: message.content, isError: message.isError };
          const saved = message as typeof partial;
          return { role: saved.role, content: saved.content, api: saved.api, provider: saved.provider, model: saved.model, stopReason: saved.stopReason, creativeEncryptedContent: saved.creativeEncryptedContent, creativeReasoningDetails: saved.creativeReasoningDetails };
        });
        const currentUser = context.messages.findLastIndex(message => message.role === "user");
        const modelFrontier: ModelFrontier = {
          version: 1, sessionId: run.sessionId, messageId: run.input.messageId, revision: run.input.revision ?? 0,
          userMarkerHash: hash({ index: currentUser, message: sequence[currentUser] }), contextHash: hash(sequence),
          providerId: identity.providerId, modelId: identity.modelId,
          controlsHash: hash({ maxTokens: Math.min(options?.maxTokens || 8192, 8192), thinkingLevel: scope.options?.thinkingLevel ?? "default" }),
        };
        const observedModelCalls = context.messages.flatMap(message => {
          const callId = (message as typeof partial).creativeUsage?.callId;
          return message.role === "assistant" && callId ? [{ id: callId, resultHash: hash(message) }] : [];
        });
        actionId = creativeAgentStableId(`${scope.runId}:model-frontier:${modelFrontierHash(scope, modelFrontier)}`);
        const action = await creativeAgentStore.claimAction({ ...scope, actionId, kind: "model.chat", inputHash, modelFrontier, observedModelCalls });
        actionId = action.id ?? actionId;
        if (!action.claimed) {
          if (action.state === "succeeded" && action.result) {
            recordCreativeDebug({ spanId: debugSpan, category: "model", type: "model.reused", title: "复用已有模型结果，未发送 API", status: "reused", summary: { actionId }, detail: action.result });
            partial = action.result as AssistantMessage;
            output.push({ type: "start", partial });
            output.push({ type: "done", reason: partial.stopReason as "stop" | "toolUse", message: partial });
            return;
          }
          throw new CreativeAgentError("MODEL_OUTCOME_UNKNOWN", "上一笔模型调用尚未确认，不能重复提交");
        }
        claimed = true;
        const calls = await creativeAgentStore.actionReceipts(scope.runId);
        if (calls.filter(call => call.kind === "model.chat").length > 40) throw new CreativeAgentError("MODEL_CALL_LIMIT", "本轮已达到模型调用上限，请检查已有成果后继续");
        const fresh = await resolveCreativeAgentModel(scope.options?.model);
        if (fresh.status !== "ready" || fresh.route.protocol !== "openai-chat" || !fresh.route.egressDecision || fresh.route.egressDecision.providerId !== fresh.route.providerId) throw new CreativeAgentError("MODEL_UNAVAILABLE", "当前选择的对话模型已不可用，请更新选择", 503);
        attempt = { callId: actionId, runId: scope.runId, purpose: "main", providerId: identity.providerId, modelId: identity.modelId, status: "prepared", usage: {}, timing: { startedAt }, structure: { requestBytes: Buffer.byteLength(JSON.stringify(body)), requestCharacters: JSON.stringify(body).length, messageCount: messages.length } };
        // The normal billing service owns price snapshots and usage settlement.
        billing = await prisma.$transaction(async tx => {
          const call = await beginLlmCost({ provider: identity.providerId, model: identity.modelId, source: "agent.chat", authUserId: scope.actorUserId }, tx);
          await tx.usageLedger.update({ where: { id: call.id }, data: { requestKey: actionId! } });
          return call;
        });
        await creativeAgentStore.assertFence(scope.runId, scope.epoch);
        await assertDurableWorkAdmission();
        options?.signal?.throwIfAborted();
        attempt.timing.intentAt = new Date().toISOString();
        await creativeAgentStore.saveLlmAttempt(scope, attempt);
        const dispatchRoute = await resolveCreativeAgentModel(scope.options?.model);
        if (dispatchRoute.status !== "ready" || dispatchRoute.route.protocol !== "openai-chat" || !dispatchRoute.route.egressDecision || dispatchRoute.route.egressDecision.providerId !== dispatchRoute.route.providerId) throw new CreativeAgentError("MODEL_UNAVAILABLE", "当前选择的对话模型已不可用，请更新选择", 503);
        const currentRoute = dispatchRoute.route;
        rememberDebugSecrets([currentRoute.apiKey]);
        const currentRequest = openAiChatAdapter.buildRequest(currentRoute, [], { tokens: Math.min(options?.maxTokens || 8192, 8192), parameter: "max_tokens" }, true, scope.options?.thinkingLevel);
        await assertDurableWorkAdmission();
        await creativeAgentStore.assertFence(scope.runId, scope.epoch);
        options?.signal?.throwIfAborted();
        timeoutMs = currentRoute.timeoutMs;
        output.push({ type: "start", partial });
        attempt.timing.dispatchedAt = new Date().toISOString();
        attempt.timing.dispatchMs = Math.round(performance.now() - debugStarted);
        dispatched = true; attempt.status = "dispatched";
        recordCreativeDebug({ spanId: debugSpan, category: "model", type: "model.dispatched", title: `已发起模型请求 · ${identity.modelId}`, status: "running", summary: { actionId, billingId: billing.id } });
        // Long tool arguments can take several minutes while still streaming normally.
        // Bound inactivity, not total output time; cancellation still aborts immediately.
        resetIdleTimeout();
        const signal = options?.signal ? AbortSignal.any([options.signal, idleController.signal]) : idleController.signal;
        const send = () => withDebugSpan(debugSpan, () => fetchWithProviderEgress(currentRoute.egressDecision!, currentRequest.url, {
          ...currentRequest.init, body: JSON.stringify(body), signal,
        } as Parameters<typeof fetchWithProviderEgress>[2]));
        let response = await send();
        // 429 是服务商明确拒绝、没有执行，可以安全地稍等后重发（最多 3 次），不必让整轮失败
        for (let retry = 1; response.status === 429 && retry <= 3; retry++) {
          const retryAfter = Number(response.headers.get("retry-after")) * 1000;
          const waitMs = retryAfter > 0 ? Math.min(retryAfter, 10_000) : [2_000, 4_000, 8_000][retry - 1];
          await response.body?.cancel().catch(() => undefined);
          recordCreativeDebug({ spanId: debugSpan, category: "model", type: "model.retry", title: `模型接口限流（429），${Math.round(waitMs / 1000)} 秒后自动重试（第 ${retry} 次）`, status: "running", summary: { retry, waitMs } });
          clearTimeout(idleTimer);
          await new Promise<void>((resolve, reject) => {
            if (signal.aborted) return reject(signal.reason);
            const onAbort = () => { clearTimeout(timer); reject(signal.reason); };
            const timer = setTimeout(() => { signal.removeEventListener("abort", onAbort); resolve(); }, waitMs);
            signal.addEventListener("abort", onAbort, { once: true });
          });
          resetIdleTimeout();
          response = await send();
        }
        resetIdleTimeout();
        attempt.timing.headersMs = Math.round(performance.now() - debugStarted);
        recordCreativeDebug({ spanId: debugSpan, category: "model", type: "model.headers", title: `模型接口返回 HTTP ${response.status}`, status: response.ok ? "running" : "error", summary: { httpStatus: response.status, responseId: response.headers.get("x-request-id") || response.headers.get("request-id"), headersMs: Math.round(performance.now() - debugStarted) } });
        if (!response.ok) {
          // Gateway/server failures cannot prove that the upstream did not execute.
          rejected = response.status >= 400 && response.status < 500 && response.status !== 408;
          const payload = await response.json().catch(() => null);
          usage = openAiChatAdapter.readUsage?.(payload);
          if (usage && attempt) attempt.usageReceivedAt = new Date().toISOString();
          syncUsage();
          if (rejected) { await finishLlmCost(billing, usage ?? null, false); settled = true; }
          throw new CreativeAgentError(rejected ? "MODEL_REJECTED" : "MODEL_OUTCOME_UNKNOWN", `对话模型暂时不可用（${response.status}）`, 502);
        }
        accepted = true;
        let textIndex = -1, thinkingIndex = -1, thinkingClosed = false;
        const announcedCalls = new Set<number>();
        const endThinking = () => {
          const content = partial.content[thinkingIndex];
          if (!thinkingClosed && content?.type === "thinking") {
            thinkingClosed = true;
            output.push({ type: "thinking_end", contentIndex: thinkingIndex, content: content.thinking, partial });
          }
        };
        const result = await readCreativeAgentChatResponse(response, delta => {
          if (delta && attempt) attempt.timing.firstTextMs ??= Math.round(performance.now() - debugStarted);
          endThinking();
          if (textIndex < 0) { textIndex = partial.content.length; partial.content.push({ type: "text", text: "" }); output.push({ type: "text_start", contentIndex: textIndex, partial }); }
          const content = partial.content[textIndex];
          if (content.type === "text") content.text += delta;
          output.push({ type: "text_delta", contentIndex: textIndex, delta, partial });
        }, raw => { usage = openAiChatAdapter.readUsage?.({ usage: raw }); if (attempt) attempt.usageReceivedAt = new Date().toISOString(); syncUsage(); }, delta => {
          if (delta && attempt) attempt.timing.firstThinkingMs ??= Math.round(performance.now() - debugStarted);
          if (thinkingIndex < 0 || thinkingClosed) { thinkingIndex = partial.content.length; thinkingClosed = false; partial.content.push({ type: "thinking", thinking: "" }); output.push({ type: "thinking_start", contentIndex: thinkingIndex, partial }); }
          const content = partial.content[thinkingIndex];
          if (content.type === "thinking") content.thinking += delta;
          output.push({ type: "thinking_delta", contentIndex: thinkingIndex, delta, partial });
        }, packet => {
          resetIdleTimeout();
          // 模型开始写工具参数时立即告知（写 4 段画面描述可能要十几秒），界面先显示步骤，不必等整段参数写完
          for (const call of (packet as { choices?: { delta?: { tool_calls?: { index?: number; id?: string; function?: { name?: string } }[] } }[] }).choices?.[0]?.delta?.tool_calls ?? []) {
            const index = call.index ?? 0;
            if (announcedCalls.has(index) || !call.id || !call.function?.name) continue;
            announcedCalls.add(index);
            const event = { type: "toolcall_start" as const, contentIndex: partial.content.length, partial, toolCallId: call.id, toolName: call.function.name };
            output.push(event);
          }
          debugFirstOutput ??= Math.round(performance.now() - debugStarted);
          if (attempt) {
            attempt.timing.firstPacketMs ??= Math.round(performance.now() - debugStarted);
            const value = packet as { choices?: { delta?: { tool_calls?: { function?: { name?: string; arguments?: string } }[] }; message?: { tool_calls?: unknown[] } }[] };
            if (value.choices?.some(c => c.delta?.tool_calls?.some(t => t.function?.name || t.function?.arguments) || c.message?.tool_calls?.length)) attempt.timing.firstToolDeltaMs ??= Math.round(performance.now() - debugStarted);
          }
          debugPackets.push(packet);
          if (debugPackets.length >= 100) flushDebugPackets();
          else debugTimer ??= setTimeout(flushDebugPackets, 250);
        });
        clearTimeout(idleTimer);
        flushDebugPackets();
        endThinking();
        if (result.encryptedContent) partial.creativeEncryptedContent = result.encryptedContent;
        if (result.reasoningDetails) partial.creativeReasoningDetails = result.reasoningDetails;
        if (result.text) output.push({ type: "text_end", contentIndex: textIndex, content: result.text, partial });
        for (const call of result.calls) {
          if (!context.tools?.some(tool => tool.name === call.name)) throw new CreativeAgentError("MODEL_TOOL_UNKNOWN", "模型请求了不可用的工具", 502);
          const toolCall = { type: "toolCall" as const, ...call };
          partial.content.push(toolCall);
          output.push({ type: "toolcall_end", contentIndex: partial.content.length - 1, toolCall, partial });
        }
        partial.stopReason = result.calls.length ? "toolUse" : "stop";
        if (result.decodeMs) partial.creativeUsage!.decodeMs = result.decodeMs;
        syncUsage();
        attempt.status = "succeeded"; attempt.timing.endedAt = new Date().toISOString(); attempt.timing.elapsedMs = Math.round(performance.now() - debugStarted);
        Object.assign(partial, { creativeAttempt: attempt });
        await finishLlmCost(billing, usage, true); settled = true;
        await creativeAgentStore.completeAction(actionId, { ...scope, state: "succeeded", result: partial });
        recordCreativeDebug({ spanId: debugSpan, category: "model", type: "model.completed", title: `模型请求完成 · ${identity.modelId}`, status: "success", summary: { actionId, elapsedMs: Math.round(performance.now() - debugStarted), firstOutputMs: debugFirstOutput, finishReason: result.finishReason, usage: usage ?? null, usageReported: partial.creativeUsage?.reported, toolCalls: result.calls.length, billingId: billing.id }, detail: { response: result, assistantMessage: partial, usage: usage ?? null, billingId: billing.id } });
        output.push({ type: "done", reason: partial.stopReason, message: partial });
      } catch (error) {
        flushDebugPackets();
        const code = options?.signal?.aborted ? "MODEL_ABORTED" : idleController.signal.aborted ? "MODEL_IDLE_TIMEOUT" : error instanceof CreativeAgentError || error instanceof HttpError ? error.code : "MODEL_STREAM_INTERRUPTED";
        const message = code === "MODEL_ABORTED" ? "任务已暂停或停止" : code === "MODEL_IDLE_TIMEOUT"
          ? "模型长时间未返回新内容，请求超时。已保留进度，可发送“继续上面的任务”接着执行。"
          : error instanceof CreativeAgentError || error instanceof HttpError ? error.message : "模型连接中断，已保留进度，可发送“继续上面的任务”接着执行。";
        // A network timeout after dispatch is an unknown cost, never a zero-cost retry.
        if (billing && !settled && (!dispatched || accepted)) await finishLlmCost(billing, usage, accepted).catch(() => undefined);
        syncUsage();
        if (attempt) { if (!dispatched) delete attempt.timing.dispatchedAt; attempt.status = dispatched && !rejected ? "unknown" : "failed"; attempt.timing.endedAt = new Date().toISOString(); attempt.timing.elapsedMs = Math.round(performance.now() - debugStarted); }
        if (claimed && actionId) await creativeAgentStore.completeAction(actionId, { ...scope, state: dispatched && !rejected ? "unknown" : "failed", result: { error: message, code, ...(attempt ? { creativeAttempt: attempt } : {}) } }).catch(() => undefined);
        const reason = options?.signal?.aborted ? "aborted" : "error";
        recordCreativeDebug({ spanId: debugSpan, category: "model", type: "model.failed", title: message, status: dispatched && !rejected ? "unknown" : "error", summary: { actionId, elapsedMs: Math.round(performance.now() - debugStarted), dispatched, accepted, rejected, code }, detail: { partialResponse: partial } });
        partial = { ...partial, stopReason: reason, errorMessage: message };
        output.push({ type: "error", reason, error: partial });
      } finally { clearTimeout(idleTimer); flushDebugPackets(); if (attempt) await creativeAgentStore.saveLlmAttempt(scope, attempt).catch(() => undefined); output.end(); }
    })();
    return output;
  };
  return { model, stream };
}
