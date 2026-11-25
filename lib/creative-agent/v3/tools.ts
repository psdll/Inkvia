import "server-only";

import { Type } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { v5 as uuidv5 } from "uuid";
import { creativeAgentStore, type CreativeAgentStore } from "../store";
import { hash, HttpError, type Run } from "../store-types";
import type { AgentCanvasSnapshot, CreativeAgentToolInput } from "../canvas-tools";
import { creativeAgentNodeHash, executeCreativeAgentCanvasTool, readCreativeAgentCanvas } from "../canvas-tools";
import type { EffectiveMediaCatalog } from "../effective-media-catalog";
import { getEffectiveCreativeMediaCatalog } from "../effective-media-catalog";
import type { CreativeAgentReference } from "../contracts";
import type { CreativeAgentPreferences } from "../preferences";
import type { ResolvedReference } from "../media-capabilities";
import { CreativeAgentError } from "../errors";
import { describeDecisionAnswer, type QuestionField } from "../questions";
import { readCreativeSkill } from "../skill-packages";
import { newDebugSpan, recordCreativeDebug } from "../debug-trace";
import { canvasAliases, describeCanvas, describeNodeDetail, mediaNodeInfo, resolveAlias } from "./canvas-context";
import { routeImage, routeVideo, type RoutedMedia } from "./model-router";
import { etaLabel, imageOutputsPerRequest } from "./model-profiles";
import { normalizeReferenceTokens } from "./asset-tokens";

const stableId = (value: string) => uuidv5(value, "6f1d1c84-3b9a-4f62-9b0e-1a7c9d2f8e31");
const TERMINAL = new Set(["success", "failed", "cancelled", "canceled"]);
/** 生成中的各种中间状态（pending/queued/processing/running）对用户都是“生成中” */
export const settledStatus = (status: unknown) => TERMINAL.has(String(status)) ? String(status) : "running";
/** 图片在工具内等待的最长时间；超时后挂起，出图后再由系统通知收尾 */
const IMAGE_WAIT_MS = 150_000;
const VIDEO_WAIT_MS = 15_000;
const POLL_MS = 2_500;
/** 合成前等待分镜视频出片的上限 */
const COMPOSE_WAIT_MS = 20 * 60_000;

export type V3Runtime = {
  run: Run;
  store: CreativeAgentStore;
  /** 用户本轮原话（识别任务类型与点名的模型） */
  userText: string;
  selection: CreativeAgentReference[];
  preferences: Pick<CreativeAgentPreferences, "image" | "video">;
  signal?: AbortSignal;
  /** 工具开始前先把模型刚说的话落库，保证对话里“说明”排在“步骤”之前 */
  beforeTool?: () => Promise<void>;
  /** 实际执行过的工具调用（提前显示的步骤据此判断是否需要补上“未执行”） */
  executed?: Set<string>;
  /** 本对话生成过的画布节点（画布摘要里标【本对话】） */
  conversationNodeIds?: string[];
};

/** 工具步骤的稳定 ID：同一轮同一次调用始终相同，提前显示的步骤与正式执行的步骤合并为一条 */
export function v3ActionId(run: Pick<Run, "id" | "input">, toolCallId: string) {
  return `v3_${hash({ runId: run.id, revision: run.input.actionRevision ?? run.input.revision ?? 0, toolCallId })}`;
}

/** 参数较长的工具：模型开始写参数时就先显示步骤 */
export const EARLY_STEPS: Record<string, { name: string; title: string }> = {
  generate_image: { name: "image.plan", title: "构思画面" },
  generate_video: { name: "video.plan", title: "构思视频" },
  write_canvas: { name: "canvas.plan", title: "整理画布内容" },
};

/** 每次调用工具时读取最新画布；目录在一轮内缓存 */
function createReaders(runtime: V3Runtime) {
  let catalog: Promise<EffectiveMediaCatalog> | undefined;
  return {
    snapshot: () => readCreativeAgentCanvas(runtime.run.actorUserId, runtime.run.canvasId),
    catalog: () => (catalog ??= getEffectiveCreativeMediaCatalog()),
  };
}

const sleep = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason ?? new Error("aborted")); }, { once: true });
});

const friendly = (error: unknown) => error instanceof CreativeAgentError || error instanceof HttpError ? error.message : error instanceof Error && error.message ? `执行出错：${error.message.slice(0, 200)}` : "执行出错，请稍后重试";

type ToolOutcome = { text: string; summary?: string; nodeIds?: string[]; images?: { data: string; mimeType: string }[]; decision?: Record<string, unknown>; details?: Record<string, unknown>; /** 工具跑完但没有任何成果（如生成全部失败）：步骤显示为失败，说明仍交给模型 */ failed?: boolean };
const allFailed = (results: { status: string }[]) => results.length > 0 && results.every(item => ["failed", "cancelled", "canceled"].includes(item.status));

/** 统一包装：写入对话活动事件与调试记录，异常转成给模型看的失败说明 */
function tool(runtime: V3Runtime, name: string, kind: string, label: string, description: string, parameters: AgentTool["parameters"], run: (args: any, context: { toolCallId: string; actionId: string; signal?: AbortSignal; setTitle(title: string): void }) => Promise<ToolOutcome>): AgentTool {
  return {
    name, label, description, parameters, executionMode: "sequential",
    execute: async (toolCallId, args, signal) => {
      const { run: current, store } = runtime;
      const actionId = v3ActionId(current, toolCallId);
      runtime.executed?.add(toolCallId);
      const span = newDebugSpan("tool");
      const started = performance.now();
      let title = label;
      const setTitle = (value: string) => { title = value; };
      await runtime.beforeTool?.();
      await store.appendEvent(current.id, current.epoch, "tool.started", { actionId, toolCallId, name: kind, title, status: "running" });
      recordCreativeDebug({ spanId: span, category: "tool", type: "tool.started", title, status: "running", summary: { toolCallId, tool: kind }, detail: { arguments: args } });
      try {
        const outcome = await run(args, { toolCallId, actionId, signal, setTitle });
        await store.appendEvent(current.id, current.epoch, "tool.completed", { actionId, toolCallId, name: kind, title, status: outcome.failed ? "error" : "success", detail: { message: outcome.summary ?? "", ...(outcome.decision ? { decision: outcome.decision } : {}) }, ...(outcome.nodeIds?.length ? { nodeIds: outcome.nodeIds } : {}) });
        recordCreativeDebug({ spanId: span, category: "tool", type: "tool.completed", title: `${title} · 完成`, status: "success", summary: { toolCallId, tool: kind, elapsedMs: Math.round(performance.now() - started) }, detail: { returnedToModel: outcome.text } });
        return { content: [{ type: "text" as const, text: outcome.text }, ...(outcome.images ?? []).map(image => ({ type: "image" as const, data: image.data, mimeType: image.mimeType }))], details: { actionId, ...outcome.details } };
      } catch (error) {
        if (error instanceof HttpError && error.code === "run_deferred") throw error;
        if (signal?.aborted) throw error;
        const message = friendly(error);
        await store.appendEvent(current.id, current.epoch, "tool.completed", { actionId, toolCallId, name: kind, title, status: "error", detail: { message } }).catch(() => undefined);
        recordCreativeDebug({ spanId: span, category: "tool", type: "tool.failed", title: `${title} · 未完成`, status: "error", summary: { toolCallId, tool: kind, elapsedMs: Math.round(performance.now() - started) }, detail: { message } });
        if (error instanceof HttpError && ["stale_epoch", "run_not_found"].includes(error.code)) throw error;
        return { content: [{ type: "text" as const, text: `未完成：${message}` }], details: { actionId, failed: true } };
      }
    },
  };
}

function toolInput(runtime: V3Runtime, actionId: string, kind: string, args: unknown, signal?: AbortSignal): CreativeAgentToolInput {
  return { actorUserId: runtime.run.actorUserId, canvasId: runtime.run.canvasId, runId: runtime.run.id, epoch: runtime.run.epoch, actionId, kind, args, signal };
}

async function resolveRefs(runtime: V3Runtime, snapshot: AgentCanvasSnapshot, refs: string[] | undefined): Promise<ResolvedReference[]> {
  if (!refs?.length) return [];
  const aliases = canvasAliases(snapshot.nodes);
  const { resolveReference } = await import("../media-broker");
  const unique = [...new Set(refs.map(ref => ref.trim()).filter(Boolean))];
  return unique.map(ref => resolveReference(snapshot, resolveAlias(snapshot, aliases, ref, runtime.selection).reference));
}

type Dispatched = { title: string; requestKey: string; generationId?: number; status: string; error?: string; nodeIds?: string[]; alias?: string; count?: number };

/** 给生成结果标上画布短编号（与画布摘要一致）；读不到画布时不影响结果 */
async function labelResults(readers: ReturnType<typeof createReaders>, results: Dispatched[]) {
  if (!results.some(item => item.nodeIds?.length)) return;
  const snapshot = await readers.snapshot().catch(() => null);
  if (!snapshot) return;
  const aliases = canvasAliases(snapshot.nodes);
  for (const item of results) {
    const node = snapshot.nodes.find(candidate => item.nodeIds?.includes(candidate.id));
    item.alias = node ? aliases.get(node.id) : undefined;
    item.count = node ? mediaNodeInfo(node)?.count : undefined;
  }
}

/** 依次提交（每个请求毫秒级返回，避免并发写画布冲突），返回每项的任务号 */
type Lineage = { retryOfGenerationId: number; retryAttempt: 1; retryReason: string };
async function dispatch(runtime: V3Runtime, actionId: string, routed: RoutedMedia, items: { title: string; prompt: string }[], signal?: AbortSignal, lineage?: (index: number) => Lineage | undefined) {
  const { run, store } = runtime;
  const { submitCreativeAgentMediaV3 } = await import("../media-broker");
  const args = { kind: routed.kind, model: routed.model, params: routed.args.params, references: routed.args.references, items };
  const action = await store.claimAction({ actorUserId: run.actorUserId, canvasId: run.canvasId, runId: run.id, actionId, epoch: run.epoch, kind: routed.kind, inputHash: hash(args) });
  const requestKeys = items.map((_, index) => stableId(`${run.id}:${actionId}:${index}`));
  if (action.state === "claimed") await store.recordMediaKeys(actionId, run.id, requestKeys);
  const results: Dispatched[] = [];
  for (const [index, item] of items.entries()) {
    signal?.throwIfAborted();
    const requestKey = requestKeys[index];
    try {
      const receipt = await submitCreativeAgentMediaV3(toolInput(runtime, actionId, routed.kind, {}, signal), { ...routed.args, prompt: item.prompt }, requestKey, item.title);
      await store.publishMedia(run, { ...receipt, status: settledStatus(receipt.status), title: item.title, ...lineage?.(index) });
      results.push({ title: item.title, requestKey, generationId: Number(receipt.generationId), status: settledStatus(receipt.status), error: typeof receipt.error === "string" ? receipt.error : undefined, nodeIds: receipt.nodeIds as string[] | undefined });
    } catch (error) {
      if (error instanceof HttpError && ["stale_epoch", "run_not_found"].includes(error.code)) throw error;
      results.push({ title: item.title, requestKey, status: "failed", error: friendly(error) });
    }
  }
  const generationIds = results.flatMap(item => item.generationId ? [item.generationId] : []);
  // 换模型重试：记下顶替的是哪一次，对话里只显示新结果，失败的那次不再占位
  const replaced = items.length === 1 ? lineage?.(0) : undefined;
  const summary = { generationIds, requestKeys, mediaDispatch: { requestKeys }, model: routed.model, modelLabel: routed.label, items: results.map(item => ({ title: item.title, generationId: item.generationId, requestKey: item.requestKey })), ...replaced };
  if (action.state === "claimed") await store.completeAction(actionId, { runId: run.id, epoch: run.epoch, state: generationIds.length ? "succeeded" : "failed", result: summary }).catch(() => undefined);
  return results;
}

/** 轮询直到全部结束或超时；状态变化时推送给前端 */
async function waitFor(runtime: V3Runtime, results: Dispatched[], kind: string, timeoutMs: number, signal?: AbortSignal) {
  const { executeCreativeAgentMediaTool } = await import("../media-broker");
  const deadline = Date.now() + timeoutMs;
  while (results.some(item => item.generationId && !TERMINAL.has(item.status)) && Date.now() < deadline) {
    await sleep(POLL_MS, signal);
    for (const item of results) {
      if (!item.generationId || TERMINAL.has(item.status)) continue;
      try {
        const receipt = await executeCreativeAgentMediaTool(toolInput(runtime, `settle:${runtime.run.id}:${item.generationId}`, "generation.read", { generationId: item.generationId }, signal));
        const status = settledStatus(receipt.status);
        if (status !== item.status) await runtime.store.publishMedia(runtime.run, { ...receipt, status, title: item.title });
        item.status = status;
        item.error = typeof receipt.error === "string" ? receipt.error : undefined;
        item.nodeIds = receipt.nodeIds as string[] | undefined;
      } catch (error) {
        if (error instanceof HttpError && ["stale_epoch", "run_not_found"].includes(error.code)) throw error;
        if (["CANVAS_REVISION_CONFLICT", "CANVAS_READ_CHANGED"].includes(String((error as { code?: string })?.code))) continue;
      }
    }
  }
  void kind;
  return results;
}

const contentRejected = /(审核|违规|敏感|安全策略|不合规|content|moderation|policy|CONTENT_REJECTED)/i;
/**
 * 智能匹配选的模型整批失败（不是内容审核、也不是被取消）时，换下一个合适的模型自动重试一次。
 * 用户点名或在偏好里固定的模型不换，失败就如实告知。
 */
async function dispatchWithFallback(runtime: V3Runtime, actionId: string, routed: RoutedMedia, reroute: (exclude: string[]) => RoutedMedia, items: { title: string; prompt: string }[], wait: (results: Dispatched[]) => Promise<unknown>, signal?: AbortSignal) {
  const results = await dispatch(runtime, actionId, routed, items, signal);
  await wait(results);
  if (!allFailed(results) || routed.reason !== "auto" || results.some(item => item.status !== "failed" || contentRejected.test(item.error ?? ""))) return { routed, results };
  let next: RoutedMedia;
  try { next = reroute([routed.model]); } catch { return { routed, results }; }
  const retried = await dispatch(runtime, `${actionId}:fallback`, next, items, signal, index => results[index]?.generationId
    ? { retryOfGenerationId: results[index].generationId!, retryAttempt: 1, retryReason: `${routed.label} 失败，已自动换用 ${next.label}` } : undefined);
  await wait(retried);
  return { routed: next, results: retried, fallbackFrom: { label: routed.label, error: results.find(item => item.error)?.error } };
}

export function describeOutcome(results: { title: string; status: string; error?: string; alias?: string; count?: number }[], label: string, extra = "") {
  const done = results.filter(item => item.status === "success").length;
  const failed = results.filter(item => ["failed", "cancelled", "canceled"].includes(item.status));
  const pending = results.length - done - failed.length;
  // 带上画布编号：用户之后说“第 2 版”“刚才那张”时，能从历史里精确对应到具体素材
  const lines = results.map((item, index) => `${index + 1}. ${item.title}${item.alias ? `（#${item.alias}${item.count && item.count > 1 ? `，共 ${item.count} 张，第 n 张用 #${item.alias}/n` : ""}）` : ""}：${item.status === "success" ? "已完成" : ["failed", "cancelled", "canceled"].includes(item.status) ? `失败（${item.error || "生成服务未返回原因"}）` : "生成中"}`);
  const head = pending ? `已提交 ${results.length} 项（${label}${extra}），${done} 项完成，${pending} 项仍在生成；生成好后会自动显示在对话和画布上，用户可以继续做别的。` : `${done} 项已完成${failed.length ? `，${failed.length} 项失败` : ""}（${label}${extra}）。结果已显示在对话和画布中。`;
  return `${head}\n${lines.join("\n")}`;
}

export function createV3Tools(runtime: V3Runtime): AgentTool[] {
  const readers = createReaders(runtime);
  const refsSchema = Type.Optional(Type.Array(Type.String({ description: "画布素材编号，如 a1b2c3；一个节点有多张图时用 a1b2c3/2 指定第 2 张" }), { maxItems: 8, description: "参考或要修改的画布素材编号" }));

  const generateImage = tool(runtime, "generate_image", "image.generate", "生成图像",
    "生成或修改图片。images 每项是一张图（版本名+完整提示词），多张并行生成；用户没说数量时只给 1 项，说了几张就给几项。修改已有图片时 refs 填该图编号、只给 1 项。prompt 里提到参考素材时写 @图片1、@图片2（按 refs 顺序编号），如「参考@图片1的产品外观，放进@图片2的场景」。",
    Type.Object({
      images: Type.Array(Type.Object({ title: Type.String({ minLength: 1, maxLength: 24, description: "版本名，如 特写暖调版" }), prompt: Type.String({ minLength: 1, maxLength: 4000 }) }, { additionalProperties: false }), { minItems: 1, maxItems: 6 }),
      refs: refsSchema,
      aspect_ratio: Type.Optional(Type.String({ description: "如 3:4、9:16、1:1、16:9" })),
      resolution: Type.Optional(Type.String({ description: "如 1K、2K、4K，一般不填" })),
      model: Type.Optional(Type.String({ description: "仅在用户点名或技能指定模型时填写模型 id" })),
    }, { additionalProperties: false }),
    async (args, { actionId, signal, setTitle }) => {
      setTitle(args.images.length > 1 ? `生成图像 · ${args.images.length} 个方向` : `生成图像 · ${args.images[0].title}`);
      const [snapshot, catalog] = await Promise.all([readers.snapshot(), readers.catalog()]);
      const references = await resolveRefs(runtime, snapshot, args.refs);
      // 提示词里引用素材统一写成 @图片N，画布上显示为素材标签，编号随参考顺序变化
      const items = (args.images as { title: string; prompt: string }[]).map(item => ({ ...item, prompt: normalizeReferenceTokens(item.prompt, references, { prefix: true }) }));
      const intent = { prompt: items[0].prompt, userText: runtime.userText, aspectRatio: args.aspect_ratio, resolution: args.resolution, modelHint: args.model, references, count: items.length };
      const { routed, results, fallbackFrom } = await dispatchWithFallback(runtime, actionId, routeImage(catalog, runtime.preferences.image, intent),
        exclude => routeImage(catalog, runtime.preferences.image, { ...intent, exclude }), items, results => waitFor(runtime, results, "image", IMAGE_WAIT_MS, signal), signal);
      const params = routed.args.params;
      await labelResults(readers, results);
      // 有的模型每次固定出多张（如 Midjourney 4 张）：告诉模型实际张数，收尾按真实数量说明
      const perRequest = imageOutputsPerRequest(routed.model);
      const text = (fallbackFrom ? `${fallbackFrom.label} 生成失败（${fallbackFrom.error || "服务未返回原因"}），已自动换用 ${routed.label} 重新生成。\n` : "") + describeOutcome(results, routed.label, `，${params.aspectRatio}${params.resolution && params.resolution !== "auto" ? ` · ${params.resolution}` : ""}`) + (perRequest > 1 ? `\n注意：${routed.label} 每次固定出 ${perRequest} 张，本次共 ${perRequest * results.length} 张图，收尾时按实际张数说明。` : "");
      const done = results.filter(item => item.status === "success").length;
      const failed = allFailed(results);
      return { text, failed, summary: failed ? `${routed.label} · 生成失败` : `${routed.label} · ${done}/${results.length} 已完成${perRequest > 1 ? ` · 共 ${perRequest * done} 张` : ""}`, nodeIds: results.flatMap(item => item.nodeIds ?? []), details: { pending: results.some(item => item.generationId && !TERMINAL.has(item.status)) } };
    });

  const generateVideo = tool(runtime, "generate_video", "video.generate", "生成视频",
    "生成视频。refs 放画布上的图片（默认作首帧）或视频/音频参考。prompt 里提到参考素材时写 @图片1、@视频1、@音频1（按 refs 顺序、各类型分别编号）。提交后几分钟出片，出片后自动显示在对话和画布上。",
    Type.Object({
      title: Type.String({ minLength: 1, maxLength: 24 }),
      prompt: Type.String({ minLength: 1, maxLength: 4000, description: "主体动作、镜头运动、节奏、氛围；分镜可按时间写" }),
      refs: refsSchema,
      duration: Type.Optional(Type.Integer({ minimum: 2, maximum: 30, description: "秒，默认 5" })),
      aspect_ratio: Type.Optional(Type.String()),
      resolution: Type.Optional(Type.String({ description: "如 720p、1080p" })),
      audio: Type.Optional(Type.Boolean({ description: "是否生成声音；默认有声，只有用户说不要声音时才传 false" })),
      mode: Type.Optional(Type.Union([Type.Literal("auto"), Type.Literal("first_frame"), Type.Literal("first_last_frame"), Type.Literal("reference")])),
      model: Type.Optional(Type.String()),
    }, { additionalProperties: false }),
    async (args, { actionId, signal, setTitle }) => {
      setTitle(`生成视频 · ${args.title}`);
      const [snapshot, catalog] = await Promise.all([readers.snapshot(), readers.catalog()]);
      const references = await resolveRefs(runtime, snapshot, args.refs);
      const intent = { prompt: args.prompt, userText: runtime.userText, aspectRatio: args.aspect_ratio, resolution: args.resolution, modelHint: args.model, references, duration: args.duration, audio: args.audio, mode: args.mode };
      const first = routeVideo(catalog, runtime.preferences.video, intent);
      // 首帧/首尾帧模式下图片就是画面本身，不强行补“参考@图片1”；多模态参考才补
      const prompt = normalizeReferenceTokens(args.prompt, references, { prefix: first.args.params.inputMode === "multimodal" });
      const { routed, results, fallbackFrom } = await dispatchWithFallback(runtime, actionId, first, exclude => routeVideo(catalog, runtime.preferences.video, { ...intent, exclude }),
        [{ title: args.title, prompt }], results => waitFor(runtime, results, "video", VIDEO_WAIT_MS, signal), signal);
      const params = routed.args.params;
      await labelResults(readers, results);
      const text = (fallbackFrom ? `${fallbackFrom.label} 提交失败（${fallbackFrom.error || "服务未返回原因"}），已自动换用 ${routed.label}。\n` : "") + describeOutcome(results, routed.label, `，${params.duration} 秒 · ${params.ratio} · ${params.resolution}，预计${etaLabel(routed.eta)}`);
      const failed = allFailed(results);
      return { text, failed, summary: failed ? `${routed.label} · 生成失败` : `${routed.label} · 预计${etaLabel(routed.eta)}`, nodeIds: results.flatMap(item => item.nodeIds ?? []), details: { pending: results.some(item => item.generationId && !TERMINAL.has(item.status)) } };
    });

  const askUser = tool(runtime, "ask_user", "user.ask", "询问你的需求",
    "缺少关键信息时向用户发一张问卷卡（1-5 题），用户提交后返回回答。能合理默认的不要问。",
    Type.Object({
      intro: Type.Optional(Type.String({ maxLength: 200, description: "问卷上方的一句说明" })),
      questions: Type.Array(Type.Object({
        question: Type.String({ minLength: 1, maxLength: 200 }),
        type: Type.Union([Type.Literal("single"), Type.Literal("multi"), Type.Literal("text")]),
        options: Type.Optional(Type.Array(Type.Object({ label: Type.String({ minLength: 1, maxLength: 60 }), description: Type.Optional(Type.String({ maxLength: 120 })) }, { additionalProperties: false }), { minItems: 2, maxItems: 6 })),
        required: Type.Optional(Type.Boolean()),
      }, { additionalProperties: false }), { minItems: 1, maxItems: 5 }),
    }, { additionalProperties: false }),
    async (args, { actionId }) => {
      const { run, store } = runtime;
      const fields: QuestionField[] = (args.questions as { question: string; type: string; options?: { label: string; description?: string }[]; required?: boolean }[]).map((item, index) => {
        const choice = item.type !== "text" && item.options?.length;
        return {
          id: `q${index + 1}`, title: item.question, type: choice ? (item.type === "multi" ? "checkbox" : "radio") : "textarea", required: item.required ?? Boolean(choice),
          ...(choice ? { options: item.options!.map((option, optionIndex) => ({ value: `o${optionIndex + 1}`, label: option.label, ...(option.description ? { description: option.description } : {}) })) } : {}),
        } as QuestionField;
      });
      const prompt = { title: args.intro?.trim() || "确认几个关键信息", question: args.intro?.trim() || "确认几个关键信息", options: [], fields };
      let decision = await store.ask(run, actionId, prompt);
      if (decision.state === "pending") {
        if (await store.defer(run.id, run.epoch, "waiting_decision")) throw new HttpError(409, "run_deferred", "等待用户回答问卷");
        decision = await store.getDecision(decision.id);
      }
      if (decision.state !== "answered") return { text: "用户没有回答问卷。按专业判断合理默认继续，或简短说明需要的信息。", summary: "未回答" };
      const described = describeDecisionAnswer(prompt, decision.answer);
      const record = { title: prompt.title, question: prompt.question, answer: described.answer, ...(described.skipped ? { skipped: true } : {}), ...(described.items ? { items: described.items } : {}) };
      if (described.skipped) return { text: "用户跳过了问卷。按专业判断合理默认，直接继续执行。", summary: "已跳过", decision: record };
      return { text: `用户的回答：\n${described.answer}\n按这些回答直接执行，不再确认。`, summary: "已回答", decision: record };
    });

  const readCanvas = tool(runtime, "read_canvas", "canvas.read", "获取画布信息",
    "读取画布。不传 ids 返回全部节点摘要；传 ids 返回这些节点的全文或完整提示词。",
    Type.Object({ ids: Type.Optional(Type.Array(Type.String(), { maxItems: 12 })) }, { additionalProperties: false }),
    async args => {
      const snapshot = await readers.snapshot();
      const selected = runtime.selection.map(reference => reference.nodeId);
      if (!args.ids?.length) {
        const digest = describeCanvas(snapshot, selected, 120, runtime.conversationNodeIds);
        return { text: digest.text, summary: `共 ${snapshot.nodes.length} 个节点` };
      }
      const aliases = canvasAliases(snapshot.nodes);
      const details = (args.ids as string[]).map(id => {
        const key = id.trim().replace(/^[#@]/, "").toLowerCase();
        const node = snapshot.nodes.find(item => aliases.get(item.id) === key || item.id === key);
        return node ? describeNodeDetail(node, aliases.get(node.id)!) : `#${key}：画布上没有这个编号`;
      });
      return { text: details.join("\n\n"), summary: `读取 ${details.length} 个节点` };
    });

  const writeCanvas = tool(runtime, "write_canvas", "canvas.write", "更新画布",
    "把文字成果写到画布：notes 新建文本卡片（脚本、文案、分镜等）；update 修改已有文本卡片。",
    Type.Object({
      notes: Type.Optional(Type.Array(Type.Object({ title: Type.String({ minLength: 1, maxLength: 60 }), text: Type.String({ minLength: 1, maxLength: 20000 }) }, { additionalProperties: false }), { maxItems: 10 })),
      update: Type.Optional(Type.Object({ id: Type.String(), title: Type.Optional(Type.String({ maxLength: 60 })), text: Type.Optional(Type.String({ maxLength: 20000 })) }, { additionalProperties: false })),
    }, { additionalProperties: false }),
    async (args, { actionId, signal }) => {
      const nodeIds: string[] = [];
      let revision: string | undefined;
      if (args.notes?.length) {
        const created = await executeCreativeAgentCanvasTool(toolInput(runtime, `${actionId}:create`, "canvas.create", { nodes: (args.notes as { title: string; text: string }[]).map(note => ({ kind: "prompt", title: note.title, text: note.text })) }, signal));
        nodeIds.push(...created.nodeIds as string[]); revision = created.revision as string;
      }
      if (args.update) {
        const snapshot = await readers.snapshot();
        const aliases = canvasAliases(snapshot.nodes);
        const key = String(args.update.id).trim().replace(/^[#@]/, "").toLowerCase();
        const node = snapshot.nodes.find(item => aliases.get(item.id) === key);
        if (!node) throw new CreativeAgentError("NODE_NOT_FOUND", `画布上没有 #${key}`, 404);
        const patch = { ...(args.update.title ? { title: args.update.title } : {}), ...(args.update.text ? { text: args.update.text } : {}) };
        const updated = await executeCreativeAgentCanvasTool(toolInput(runtime, `${actionId}:patch`, "canvas.patch", { nodeId: node.id, expectedHash: creativeAgentNodeHash(node), patch }, signal));
        nodeIds.push(...updated.nodeIds as string[]); revision = updated.revision as string;
      }
      if (!nodeIds.length) return { text: "没有需要写入的内容。", summary: "无变化" };
      if (revision) await runtime.store.appendEvent(runtime.run.id, runtime.run.epoch, "canvas.committed", { revision, nodeIds });
      return { text: `已写入画布 ${nodeIds.length} 个文本卡片。`, summary: `已写入 ${nodeIds.length} 个卡片`, nodeIds };
    });

  const loadSkill = tool(runtime, "load_skill", "skill.load", "技能学习",
    "读取技能的完整方法。id 用技能目录里的 id；file 读取技能附带的参考文件（可选）。",
    Type.Object({ id: Type.String({ pattern: "^(system|personal):[1-9][0-9]*$" }), file: Type.Optional(Type.String({ maxLength: 300 })) }, { additionalProperties: false }),
    async (args, { setTitle }) => {
      const skill = await readCreativeSkill(runtime.run.actorUserId, args.id, args.file);
      setTitle(`技能学习 · ${skill.name}`);
      const body = String(skill.content).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/, "").trim();
      const files = Array.isArray(skill.files) ? (skill.files as unknown[]).map(file => typeof file === "string" ? file : (file as { path?: string })?.path).filter(Boolean) : [];
      const clipped = body.length > 16000 ? `${body.slice(0, 16000)}\n…（内容较长，已截断；需要后续章节时用 file 读取）` : body;
      return { text: `技能《${skill.name}》${args.file ? ` · ${args.file}` : ""}\n${clipped}${files.length && !args.file ? `\n\n可读取的参考文件：${files.join("、")}` : ""}`, summary: `已读取《${skill.name}》` };
    });

  const viewMedia = tool(runtime, "view_media", "media.view", "查看素材",
    "查看画布上某张图片（或视频抽帧）的实际画面，用于分析、点评或基于画面细节修改。",
    Type.Object({ id: Type.String() }, { additionalProperties: false }),
    async (args, { actionId, signal }) => {
      const snapshot = await readers.snapshot();
      const aliases = canvasAliases(snapshot.nodes);
      const { node, reference } = resolveAlias(snapshot, aliases, args.id, runtime.selection);
      const { inspectCreativeMedia } = await import("../media-inspection");
      const result = await inspectCreativeMedia({ ...toolInput(runtime, actionId, "media.inspect", { nodeId: node.id, semanticHash: reference.semanticHash, ...(reference.batchId ? { batchId: reference.batchId } : {}), ...(reference.outputId ? { outputId: reference.outputId } : {}) }, signal) } as never);
      const images = Array.isArray(result.images) ? (result.images as { data?: unknown; mimeType?: unknown }[]).filter((item): item is { data: string; mimeType: string } => typeof item?.data === "string" && typeof item?.mimeType === "string") : [];
      if (!images.length) return { text: `暂时无法查看 #${aliases.get(node.id)} 的画面${typeof result.coverage === "string" ? `：${result.coverage}` : ""}`, summary: "无法查看" };
      return { text: `#${aliases.get(node.id)} 的画面如下${typeof result.coverage === "string" ? `（${result.coverage}）` : ""}。`, summary: "已查看", images };
    });

  const analyzeVideo = tool(runtime, "analyze_video", "media.analyze", "拆解视频",
    "拆解画布上的视频（爆款、竞品或用户上传的参考视频）：返回镜头切分、按时间排列的关键帧和带时间的台词，用来分析结构、前 3 秒钩子、节奏和镜头语言，或照它的结构复刻。传音频时只返回台词。",
    Type.Object({ id: Type.String({ description: "画布上视频或音频的编号" }) }, { additionalProperties: false }),
    async (args, { actionId, signal, setTitle }) => {
      const snapshot = await readers.snapshot();
      const aliases = canvasAliases(snapshot.nodes);
      const { node, reference } = resolveAlias(snapshot, aliases, args.id, runtime.selection);
      const alias = aliases.get(node.id)!;
      setTitle(`拆解视频 · ${("title" in node.data && typeof node.data.title === "string" && node.data.title) || `#${alias}`}`);
      const { analyzeCreativeVideo, describeBreakdown } = await import("../video-analysis");
      const breakdown = await analyzeCreativeVideo({ ...toolInput(runtime, actionId, "media.inspect", { nodeId: node.id, semanticHash: reference.semanticHash, ...(reference.batchId ? { batchId: reference.batchId } : {}), ...(reference.outputId ? { outputId: reference.outputId } : {}) }, signal) } as never);
      const summary = [breakdown.shots.length ? `${breakdown.shots.length} 个镜头` : "", breakdown.transcript.length ? `${breakdown.transcript.length} 句台词` : breakdown.transcriptNote ? "无台词" : ""].filter(Boolean).join(" · ") || "已拆解";
      return { text: describeBreakdown(alias, breakdown), summary, images: breakdown.frames.map(frame => ({ data: frame.data, mimeType: frame.mimeType })) };
    });

  const hotTopics = tool(runtime, "hot_topics", "trends.read", "查看热点",
    "读取当前微博、知乎热榜，用于找选题、蹭热点、写贴合当下的创意。",
    Type.Object({ category: Type.Optional(Type.String({ maxLength: 40, description: "品类或行业，如 美妆、家居" })) }, { additionalProperties: false }),
    async () => {
      const { getTrending } = await import("@/lib/trending");
      const items = (await getTrending()).slice(0, 30);
      if (!items.length) return { text: "暂时读不到热榜（热榜接口不可用）。可以按季节、节日和品类常见话题来策划，并如实告诉用户没拿到实时热榜。", summary: "未读到热榜" };
      const label: Record<string, string> = { weibo: "微博", zhihu: "知乎" };
      const lines = items.map(item => `${label[item.platform] ?? item.platform}${item.rank ? ` #${item.rank}` : ""}：${item.keyword}${item.heat ? `（${item.heat}）` : ""}${item.category ? ` · ${item.category}` : ""}`);
      return { text: `当前热点（${new Date().toLocaleDateString("zh-CN")}）：\n${lines.join("\n")}`, summary: `${items.length} 条热点` };
    });

  const composeVideo = tool(runtime, "compose_video", "video.compose", "合成成片",
    "把画布上的多段视频按顺序拼成一条成片（如两段 15 秒合成 30 秒），可加背景音乐（画布上的音频）和每段字幕，成片作为新视频放到画布上。还在渲染的视频会先等它出片再合成，不用等用户再说一遍。",
    Type.Object({
      title: Type.String({ minLength: 1, maxLength: 40 }),
      clips: Type.Array(Type.Object({ id: Type.String({ description: "视频编号" }), caption: Type.Optional(Type.String({ maxLength: 60, description: "这段的字幕，可不填" })) }, { additionalProperties: false }), { minItems: 2, maxItems: 20 }),
      bgm: Type.Optional(Type.String({ description: "背景音乐的音频编号" })),
      bgm_volume: Type.Optional(Type.Number({ minimum: 0.05, maximum: 1, description: "背景音乐音量，默认 0.35" })),
      keep_original_audio: Type.Optional(Type.Boolean({ description: "保留各段原声，默认保留" })),
    }, { additionalProperties: false }),
    async (args, { actionId, signal, setTitle }) => {
      setTitle(`合成成片 · ${args.title}`);
      // 还在渲染的分镜先等出片（最多 20 分钟），出片后马上合成；失败或超时的段如实告诉用户
      const keys = (args.clips as { id: string }[]).map(clip => clip.id.trim().replace(/^[#@]/, "").split("/")[0].toLowerCase());
      const clipNodes = (current: AgentCanvasSnapshot) => { const map = canvasAliases(current.nodes); return keys.map(key => current.nodes.find(node => map.get(node.id) === key || node.id === key)); };
      let snapshot = await readers.snapshot();
      const rendering = clipNodes(snapshot).filter(node => node?.data.kind === "videoTask" && !TERMINAL.has(node.data.status));
      if (rendering.length) {
        setTitle(`合成成片 · 等 ${rendering.length} 段出片`);
        const { default: prisma } = await import("@/lib/prisma");
        const requestKeys = rendering.flatMap(node => node?.data.kind === "videoTask" && node.data.requestKey ? [node.data.requestKey] : []);
        const rows = await prisma.generation.findMany({ where: { requestKey: { in: requestKeys }, canvasId: runtime.run.canvasId }, select: { id: true, requestKey: true } });
        const titleOf = (requestKey: string | null) => { const data = rendering.find(node => node?.data.kind === "videoTask" && node.data.requestKey === requestKey)?.data; return data?.kind === "videoTask" && data.title || "视频"; };
        const waiting: Dispatched[] = rows.map(row => ({ title: titleOf(row.requestKey), requestKey: row.requestKey!, generationId: row.id, status: "running" }));
        await waitFor(runtime, waiting, "video", COMPOSE_WAIT_MS, signal);
        snapshot = await readers.snapshot();
        setTitle(`合成成片 · ${args.title}`);
      }
      const notReady = clipNodes(snapshot).flatMap((node, index) => !node ? [`第 ${index + 1} 段（画布上找不到）`] : node.data.kind === "videoTask" && node.data.status !== "success" ? [`「${node.data.title || `第 ${index + 1} 段`}」${node.data.status === "failed" ? "生成失败" : "还没出片"}`] : []);
      if (notReady.length) throw new CreativeAgentError("COMPOSE_CLIPS_NOT_READY", `${notReady.join("、")}，先把这几段重新生成好再合成`, 409);
      const aliases = canvasAliases(snapshot.nodes);
      const target = (id: string) => {
        const { node, reference } = resolveAlias(snapshot, aliases, id, runtime.selection);
        return { nodeId: node.id, semanticHash: reference.semanticHash, ...(reference.batchId ? { batchId: reference.batchId } : {}), ...(reference.outputId ? { outputId: reference.outputId } : {}) };
      };
      const clips = (args.clips as { id: string; caption?: string }[]).map(clip => ({ target: target(clip.id), caption: clip.caption }));
      const { composeCreativeVideo } = await import("../video-compose");
      const { run } = runtime;
      const result = await composeCreativeVideo({ actorUserId: run.actorUserId, canvasId: run.canvasId, runId: run.id, epoch: run.epoch, actionId, signal } as never, {
        nodeId: stableId(`compose:${run.canvasId}:${actionId}`), title: args.title, clips,
        bgm: args.bgm ? { target: target(args.bgm), volume: args.bgm_volume ?? 0.35 } : undefined, keepOriginalAudio: args.keep_original_audio ?? true,
      });
      if (!result.reused) await runtime.store.appendEvent(run.id, run.epoch, "canvas.committed", { revision: result.revision, nodeIds: [result.nodeId] });
      const fresh = await readers.snapshot().catch(() => null);
      const alias = fresh ? canvasAliases(fresh.nodes).get(result.nodeId) : undefined;
      const seconds = result.reused ? "" : `${result.durationSeconds.toFixed(1)} 秒`;
      const spec = result.reused ? "" : `，${seconds} · ${result.width}×${result.height}`;
      return { text: `成片「${args.title}」已合成${spec}${alias ? `（#${alias}）` : ""}，已放到画布上分镜视频的右侧。${args.bgm ? "已加背景音乐。" : ""}${clips.some(clip => clip.caption) ? "字幕已烧录进画面。" : ""}`, summary: `${clips.length} 段合成${seconds ? ` · ${seconds}` : ""}`, nodeIds: [result.nodeId] };
    });

  return [generateImage, generateVideo, askUser, readCanvas, writeCanvas, loadSkill, viewMedia, analyzeVideo, hotTopics, composeVideo];
}

export { createReaders as createV3Readers };
export const v3Store = creativeAgentStore;
