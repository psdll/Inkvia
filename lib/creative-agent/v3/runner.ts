import "server-only";

import { Agent, type AgentMessage, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import { assertDurableWorkAdmission, MaintenanceSubmissionError } from "@/lib/maintenance";
import { CreativeAgentError } from "../errors";
import { creativeAgentStore, type CreativeAgentStore } from "../store";
import { HttpError, type Run } from "../store-types";
import { readCreativeAgentCanvas } from "../canvas-tools";
import { getEffectiveCreativeMediaCatalog } from "../effective-media-catalog";
import { prepareCreativeAgentReferences } from "../reference-preparation";
import { readCreativeAgentAttachments } from "../attachments";
import { listCreativeSkills, readCreativeSkill } from "../skill-packages";
import { parseCreativeSkillCommand } from "../skill-command";
import { resolveCreativeAgentPreferences } from "../preferences";
import { repairPendingToolResults } from "../runner";
import { describeCanvas } from "./canvas-context";
import { describeModelMenu } from "./model-router";
import { buildCreativeAgentV3SystemPrompt } from "./prompt";
import { createV3Tools, EARLY_STEPS, v3ActionId, type V3Runtime } from "./tools";
import { splitNextSteps } from "../next-steps";

/** 一轮最多调用模型的次数：分镜逐镜出图、检查、出视频、合成都要步数；可用环境变量调整 */
const MAX_MODEL_CALLS = Math.max(10, Number(process.env.INKVIA_AGENT_MAX_STEPS) || 40);

export type CreativeAgentV3Dependencies = {
  store?: CreativeAgentStore;
  model: Model<Api>;
  stream: StreamFn;
  signal?: AbortSignal;
  maxModelCalls?: number;
  /** 真正要调用模型前才发出“模型/思考强度”状态（纯轮询生成进度时不发） */
  announce?: () => Promise<void>;
};

const SKILL_MARK = "\n\n【已选技能：";
const OBSERVATION = "【系统通知】";
/** 历史对话保留的字符预算（双方文字 + 截短后的工具调用） */
const HISTORY_CHARS = 24_000;

const messageText = (message: AgentMessage) => {
  if (message.role !== "user" && message.role !== "assistant") return "";
  const content = message.content as string | { type: string; text?: string }[];
  return typeof content === "string" ? content : content.filter(part => part.type === "text").map(part => part.text ?? "").join("\n");
};

/** 工具参数里的长文本（提示词等）截短，只保留“做过什么”的轮廓 */
function shorten(value: unknown, max = 160): unknown {
  if (typeof value === "string") return value.length > max ? `${value.slice(0, max)}…` : value;
  if (Array.isArray(value)) return value.slice(0, 8).map(item => shorten(item, max));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shorten(item, max)]));
  return value;
}
const sizeOf = (message: AgentMessage) => message.role === "toolResult"
  ? (message.content as { type: string; text?: string }[]).reduce((total, part) => total + (part.text?.length ?? 0), 0)
  : messageText(message).length + (message.role === "assistant" ? JSON.stringify((message.content as { type: string }[]).filter(part => part.type === "toolCall")).length : 0);

/**
 * 旧轮次压缩：去掉思考过程、技能正文和图片，工具调用的参数与结果截短后保留。
 * 不能把工具调用整个删掉——模型只看到“说完就算做完”的历史，会模仿着不调用工具直接宣布完成。
 */
export function compactHistory(messages: AgentMessage[], currentStart: number): AgentMessage[] {
  const history: AgentMessage[] = [];
  const source = messages.slice(0, Math.max(0, currentStart));
  const answered = new Set(source.flatMap(message => message.role === "toolResult" ? [message.toolCallId] : []));
  const keptCalls = new Set<string>();
  for (const message of source) {
    if (message.role === "user") {
      let text = messageText(message);
      if (text.startsWith("用户为本轮选择了以下技能。")) {
        // 旧版技能展开：只保留用户自己的要求
        const tail = text.split(/\n\n用户(?:本轮)?(?:要求|请求|输入)[：:]/).at(-1) ?? "";
        text = `【使用了技能】${tail.slice(0, 2000)}`;
      }
      const mark = text.indexOf(SKILL_MARK);
      if (mark >= 0) text = text.slice(0, text.indexOf("\n", mark + SKILL_MARK.length) > 0 ? text.indexOf("\n", mark + SKILL_MARK.length) : undefined);
      // 系统提醒只对当轮有效，不带入历史
      if (text.startsWith(OBSERVATION)) continue;
      if (!text.trim()) continue;
      history.push({ role: "user", content: text.slice(0, 4000), timestamp: message.timestamp });
    } else if (message.role === "assistant") {
      const text = messageText(message).trim();
      const calls = (message.content as { type: string; id?: string; arguments?: unknown }[])
        .filter(part => part.type === "toolCall" && answered.has(part.id ?? ""))
        .map(part => ({ ...part, arguments: shorten(part.arguments) }));
      if (!text && !calls.length) continue;
      for (const call of calls) keptCalls.add(call.id!);
      history.push({ ...message, content: [...(text ? [{ type: "text", text: text.slice(0, 4000) }] : []), ...calls], stopReason: calls.length ? "toolUse" : "stop" } as AgentMessage);
    } else if (message.role === "toolResult" && keptCalls.has(message.toolCallId)) {
      const text = (message.content as { type: string; text?: string }[]).filter(part => part.type === "text").map(part => part.text ?? "").join("\n").trim();
      history.push({ ...message, content: [{ type: "text", text: (text || (message.isError ? "未完成" : "已完成")).slice(0, 400) }] } as AgentMessage);
    }
  }
  // 从最近往前保留，直到用完预算；保证以用户消息开头
  let size = 0, start = history.length;
  for (let index = history.length - 1; index >= 0; index--) {
    size += sizeOf(history[index]);
    if (size > HISTORY_CHARS) break;
    start = index;
  }
  while (start < history.length && history[start].role !== "user") start++;
  const kept = history.slice(start);
  // 合并相邻同角色消息，避免部分模型拒绝连续的同角色消息
  const merged: AgentMessage[] = [];
  for (const message of kept) {
    const last = merged.at(-1);
    if (last && last.role === "assistant" && message.role === "assistant" && last.stopReason !== "toolUse") {
      merged[merged.length - 1] = { ...message, content: [...(last.content as unknown[]), ...(message.content as unknown[])] } as AgentMessage;
    } else merged.push(message);
  }
  return merged;
}

function preferenceSummary(preferences: ReturnType<typeof resolveCreativeAgentPreferences>, catalog: Awaited<ReturnType<typeof getEffectiveCreativeMediaCatalog>>) {
  const label = (id: string | undefined, models: { id: string; label: string }[]) => models.find(model => model.id === id)?.label ?? id;
  const image = preferences.image?.mode === "explicit" && preferences.image.model ? `图片固定使用「${label(preferences.image.model, catalog.image)}」（必须使用，不要换）` : "图片智能匹配";
  const video = preferences.video?.mode === "explicit" && preferences.video.model ? `视频固定使用「${label(preferences.video.model, catalog.video)}」（必须使用，不要换）` : "视频智能匹配";
  const params = [
    preferences.image?.params?.aspectRatio && !["auto", "smart"].includes(preferences.image.params.aspectRatio) ? `图片比例固定 ${preferences.image.params.aspectRatio}` : "",
    preferences.image?.params?.resolution && !["auto", "smart"].includes(preferences.image.params.resolution) ? `图片分辨率 ${preferences.image.params.resolution}` : "",
    preferences.video?.params?.ratio && !["auto", "smart", "adaptive"].includes(preferences.video.params.ratio) ? `视频比例固定 ${preferences.video.params.ratio}` : "",
    preferences.video?.params?.duration ? `视频时长 ${preferences.video.params.duration} 秒` : "",
  ].filter(Boolean);
  return [image, video, ...params].join("；");
}

const completionCue = /(已完成|已经完成|完成了|做好了|做完了|出好了|生成好了|改好了|都好了|已做好|已经(做好|生成|改好|移除|去掉|处理好|出好)|已(移除|去掉|生成|改好|替换|出图))/;
/** 文字类任务（写脚本、文案等）本身就是交付，回答里说“完成”不算假完成 */
const textTaskCue = /(脚本|文案|方案|提示词|分镜|剧本|大纲|故事|台词|标题|介绍|分析|总结|建议|怎么写)/;
/** 去掉“提前宣布完成”的段落及其之后的内容，只保留前面的打算说明 */
export function stripPrematureCompletion(text: string) {
  const paragraphs = text.trim().split(/\n{2,}/);
  const cut = paragraphs.findIndex(paragraph => completionCue.test(paragraph));
  return (cut < 0 ? paragraphs : paragraphs.slice(0, cut)).join("\n\n").trim();
}
const intentCue = /(我(会|来|先|就|将|按|基于|把|给你|帮你|现在|马上|这就|直接)|现在(开始|就|去|生成|提交|给你)|接下来|马上|稍等|这就)/;
const actionCue = /(做|生成|画|出一|出张|出个|出几|再出|出\s*[0-9一二两三四五六七八九十]+\s*[张版个幅]|[0-9一二两三四五六七八九十几]+\s*版|改|换|去掉|去除|删|加上|加个|修|制作|设计|再来|变成|调整|扩图|抠图|合成|拼接|拼起来|拼成|合并|剪辑|成片|视频|海报|封面|图)/;
const questionCue = /([?？]\s*$|吗\s*$|怎么|如何|为什么|是什么|什么是|有哪些|能不能告诉)/;
const ACTION_TOOLS = new Set(["generate_image", "generate_video", "write_canvas", "compose_video"]);
/** 用户要的是动作，模型最后一句是“要动手”的表述，但在最后一次问卷回答之后没有调用过任何执行类工具 */
export function saidButDidNot(messages: AgentMessage[], timestamp: number, userText: string) {
  if (!actionCue.test(userText) || questionCue.test(userText.trim())) return false;
  const start = messages.findIndex(message => message.role === "user" && message.timestamp === timestamp);
  if (start < 0) return false;
  let turn = messages.slice(start + 1);
  const answered = turn.findLastIndex(message => message.role === "toolResult" && message.toolName === "ask_user");
  if (answered >= 0) turn = turn.slice(answered + 1);
  if (turn.some(message => message.role === "assistant" && (message.content as { type: string; name?: string }[]).some(part => part.type === "toolCall" && ACTION_TOOLS.has(part.name ?? "")))) return false;
  const last = turn.findLast(message => message.role === "assistant");
  if (!last || last.stopReason !== "stop") return false;
  const text = splitNextSteps(messageText(last)).body.trim();
  if (!text || /[?？]\s*$/.test(text)) return false;
  // 没调用任何生成工具却宣布“做好了”，不论长短都是假完成
  if (completionCue.test(text) && !textTaskCue.test(userText)) return true;
  return text.length <= 240 && intentCue.test(text);
}

async function expandSelectedSkill(run: Run, text: string, emit: (event: "tool.started" | "tool.completed", payload: Record<string, unknown>) => Promise<void>) {
  const command = parseCreativeSkillCommand(text);
  const skillId = run.input.selectedSkillId ?? (command && /^(system|personal):[1-9]\d*$/.test(command.skillId) ? command.skillId : undefined);
  const request = command ? command.request : text;
  if (!skillId) return { request, prompt: request, skillName: null as string | null };
  const actionId = `v3_skill_${run.id}_${run.input.revision ?? 0}`;
  await emit("tool.started", { actionId, name: "skill.load", title: "技能准备", status: "running" });
  try {
    const skill = await readCreativeSkill(run.actorUserId, skillId);
    const body = String(skill.content).replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n)?/, "").trim();
    await emit("tool.completed", { actionId, name: "skill.load", title: `技能准备 · ${skill.name}`, status: "success", detail: { message: `已加载《${skill.name}》` } });
    const files = Array.isArray(skill.files) ? (skill.files as unknown[]).map(file => typeof file === "string" ? file : (file as { path?: string })?.path).filter(Boolean) : [];
    return { request, skillName: skill.name as string, prompt: `${request || "按技能流程开始"}${SKILL_MARK}${skill.name}（${skill.id}）】\n${body.length > 16000 ? `${body.slice(0, 16000)}\n…（已截断，后续章节用 load_skill 的 file 读取）` : body}${files.length ? `\n\n技能参考文件：${files.join("、")}` : ""}` };
  } catch (error) {
    await emit("tool.completed", { actionId, name: "skill.load", title: "技能准备", status: "error", detail: { message: "所选技能未能加载，可能已下架或不可用" } });
    throw error;
  }
}

export async function runCreativeAgentV3(run: Run, dependencies: CreativeAgentV3Dependencies): Promise<void> {
  const store = dependencies.store ?? creativeAgentStore;
  let agent: Agent | undefined;
  let modelFailure: string | null = null;
  let messageId = "";
  let assistantIndex = 0;
  let modelCalls = 0;
  let eventWrites: Promise<void> = Promise.resolve();
  let eventFailure: unknown;
  let deltaTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingText = "", pendingThinking = "", thinkingContent = "";
  let thinkingStarted = 0, thinkingDuration = 0;
  let messageStartedAt: Date | undefined;
  const enqueue = (write: () => Promise<unknown>) => {
    eventWrites = eventWrites.then(async () => { if (!eventFailure) await write(); }).catch(error => { eventFailure = error; agent?.abort(); });
  };
  const flush = () => {
    clearTimeout(deltaTimer); deltaTimer = undefined;
    const id = messageId;
    if (pendingThinking) { const delta = pendingThinking; pendingThinking = ""; const duration = thinkingDuration + (thinkingStarted ? (performance.now() - thinkingStarted) / 1000 : 0); enqueue(() => store.appendEvent(run.id, run.epoch, "thinking.delta", { messageId: id, delta, duration })); }
    if (pendingText) { const delta = pendingText; pendingText = ""; enqueue(() => store.appendEvent(run.id, run.epoch, "text.delta", { messageId: id, delta })); }
  };
  const finishThinking = () => {
    if (!thinkingStarted) return;
    flush();
    thinkingDuration += (performance.now() - thinkingStarted) / 1000; thinkingStarted = 0;
    const id = messageId, content = thinkingContent, duration = thinkingDuration;
    enqueue(() => store.appendEvent(run.id, run.epoch, "thinking.completed", { messageId: id, content, duration }));
  };
  const drain = async () => { flush(); await eventWrites; if (eventFailure) throw eventFailure; };
  // 模型开始写长参数时提前显示的步骤；没有真正执行的在结束时补上“未执行”，不会一直转圈
  const executed = new Set<string>();
  const early = new Map<string, { actionId: string; name: string; title: string }>();
  const closeEarly = (message: string) => {
    for (const [toolCallId, step] of early) if (!executed.has(toolCallId)) enqueue(() => store.appendEvent(run.id, run.epoch, "tool.completed", { actionId: step.actionId, toolCallId, name: step.name, title: step.title, status: "error", detail: { message } }));
    early.clear();
  };
  const abort = () => agent?.abort();
  dependencies.signal?.addEventListener("abort", abort, { once: true });
  try {
    dependencies.signal?.throwIfAborted();
    await store.assertFence(run.id, run.epoch);
    const timestamp = Date.parse(run.createdAt);
    let messages = await store.getTranscript(run.sessionId) as AgentMessage[];
    const hasInput = messages.some(message => message.role === "user" && message.timestamp === timestamp);

    // 上传的附件先放到画布，成为可引用的素材
    let preparedRecords: import("../attachments").CreativeAgentAttachmentRecord[] | undefined;
    if (!hasInput && run.input.attachments?.length) {
      const prepared = await prepareCreativeAgentReferences(run, undefined, dependencies.signal, records => { preparedRecords = records; });
      run = await store.savePreparedReferences(run.id, run.epoch, prepared.selection, prepared.revision);
    }
    const selection = (run.input.preparedSelection ?? run.input.selection).references;
    const preferences = resolveCreativeAgentPreferences(run.input.preferences);
    const rawText = run.input.text;
    const userRequest = parseCreativeSkillCommand(rawText)?.request ?? rawText;
    const runtime: V3Runtime = { run, store, userText: userRequest, selection, preferences, signal: dependencies.signal, beforeTool: () => drain(), executed };
    const tools: AgentTool[] = createV3Tools(runtime);

    // 旧版本留下的“等待生成结果”状态：本轮的话已经说完，直接结束；生成结果由后台送达
    const last = messages.at(-1);
    if (hasInput && last?.role === "assistant" && last.stopReason === "stop") { await store.finish(run.id, run.epoch, "completed"); return; }

    const [snapshot, catalog, skills] = await Promise.all([
      readCreativeAgentCanvas(run.actorUserId, run.canvasId),
      getEffectiveCreativeMediaCatalog(),
      listCreativeSkills(run.actorUserId).catch(() => []),
    ]);
    const conversationNodes = await Promise.resolve(store.sessionNodeIds?.(run.sessionId) ?? []).catch(() => [] as string[]);
    runtime.conversationNodeIds = conversationNodes;
    const canvas = describeCanvas(snapshot, selection.map(reference => reference.nodeId), 40, conversationNodes);
    const sessionSkill = run.input.conversationContext?.skillId;
    const sessionSkillName = sessionSkill ? skills.find(skill => skill.id === sessionSkill)?.name : null;
    const systemPrompt = buildCreativeAgentV3SystemPrompt({
      canvas: canvas.text,
      preferences: preferenceSummary(preferences, catalog),
      models: describeModelMenu(catalog),
      skills: skills.slice(0, 30).map(skill => `${skill.id}｜${skill.name}${skill.description ? `：${String(skill.description).replace(/\s+/g, " ").slice(0, 60)}` : ""}`),
      selectedSkill: sessionSkillName ? `《${sessionSkillName}》（${sessionSkill}）。延续这个任务需要方法细节时用 load_skill 读取` : null,
      attachments: run.input.attachments?.length ? selection.map(reference => `#${canvas.aliases.get(reference.nodeId)}「${reference.label}」`).join("、") : undefined,
    });

    await dependencies.announce?.();
    if (hasInput) messages = await repairPendingToolResults(messages, tools, dependencies.signal, true, undefined, restored => store.saveTranscript(run.id, run.epoch, restored));
    await store.saveTranscript(run.id, run.epoch, messages);

    agent = new Agent({
      initialState: { model: dependencies.model, systemPrompt, messages, tools, thinkingLevel: "off" },
      sessionId: run.sessionId,
      toolExecution: "sequential",
      streamFn: async (model, context, options) => {
        await assertDurableWorkAdmission();
        await store.assertFence(run.id, run.epoch);
        if (++modelCalls > (dependencies.maxModelCalls ?? MAX_MODEL_CALLS)) throw new CreativeAgentError("MODEL_CALL_LIMIT", "步骤较多，先停在这里，已完成的成果都保留了。点发送键位置的 ▶ 继续执行，从这里接着做。");
        const current = context.messages.findIndex(message => message.role === "user" && message.timestamp === timestamp);
        const compacted = (current < 0 ? context.messages : [...compactHistory(context.messages as AgentMessage[], current), ...context.messages.slice(current)]) as typeof context.messages;
        return dependencies.stream(model, { ...context, messages: compacted, systemPrompt }, { ...options, maxRetries: 0 });
      },
    });
    agent.subscribe(event => {
      if (event.type === "message_start" && event.message.role === "assistant") {
        flush(); messageId = `${run.id}:a:${run.epoch}:${++assistantIndex}`; messageStartedAt = new Date();
        thinkingContent = ""; thinkingDuration = 0; thinkingStarted = 0;
      }
      if (event.type === "message_update") {
        const part = event.assistantMessageEvent;
        if (part.type === "thinking_delta") { if (!thinkingStarted) thinkingStarted = performance.now(); pendingThinking += part.delta; thinkingContent += part.delta; }
        else if (part.type === "text_delta") { finishThinking(); pendingText += part.delta; }
        else if (part.type === "thinking_end") finishThinking();
        else if (part.type === "toolcall_start") {
          const { toolCallId, toolName } = part as { toolCallId?: string; toolName?: string };
          const step = toolName ? EARLY_STEPS[toolName] : undefined;
          if (toolCallId && step && !early.has(toolCallId)) {
            finishThinking(); flush();
            const actionId = v3ActionId(run, toolCallId);
            early.set(toolCallId, { actionId, ...step });
            enqueue(() => store.appendEvent(run.id, run.epoch, "tool.started", { actionId, toolCallId, ...step, status: "running" }));
          }
        }
        if ((pendingThinking || pendingText) && !deltaTimer) deltaTimer = setTimeout(flush, 50);
      }
      if (event.type === "tool_execution_end" && early.has(event.toolCallId)) {
        const step = early.get(event.toolCallId)!;
        early.delete(event.toolCallId);
        if (!executed.has(event.toolCallId)) enqueue(() => store.appendEvent(run.id, run.epoch, "tool.completed", { actionId: step.actionId, toolCallId: event.toolCallId, name: step.name, title: step.title, status: "error", detail: { message: "参数不完整，已重新调整" } }));
      }
      if (event.type === "message_end") {
        finishThinking(); flush();
        const transcript = structuredClone(agent!.state.messages);
        enqueue(() => store.saveTranscript(run.id, run.epoch, transcript));
        if (event.message.role === "assistant") {
          const text = event.message.content.filter(part => part.type === "text").map(part => part.text).join("");
          const thinking = event.message.content.filter(part => part.type === "thinking").map(part => part.thinking).join("");
          const id = messageId, startedAt = messageStartedAt;
          if (text || thinking) enqueue(() => store.saveAssistant(run.id, run.epoch, id, text, thinking ? { content: thinking, ...(thinkingDuration ? { duration: thinkingDuration } : {}), streaming: false } : undefined, startedAt));
          if (event.message.stopReason === "error") modelFailure = event.message.errorMessage || "对话模型请求失败，本轮未完成。";
          if (event.message.stopReason === "aborted") modelFailure = "模型请求已中断，本轮未完成。";
          if (event.message.stopReason === "length") modelFailure = "回复过长被截断，请让我分段继续。";
        }
      }
    });

    if (!hasInput) {
      const skill = await expandSelectedSkill(run, rawText, (type, payload) => store.appendEvent(run.id, run.epoch, type, payload));
      const attachmentParts = run.input.attachments?.length ? await readCreativeAgentAttachments({ ...run.input, sessionId: run.sessionId }, dependencies.model.input.includes("image"), preparedRecords) : [];
      const selectionNote = selection.length && !run.input.attachments?.length ? `\n\n（我选中了画布上的：${selection.map(reference => `#${canvas.aliases.get(reference.nodeId)}「${reference.label}」`).join("、")}）` : "";
      const text = `${skill.prompt}${selectionNote}`;
      const images = attachmentParts.filter(part => part.type === "image");
      await agent.prompt({ role: "user", content: images.length ? [{ type: "text", text }, ...images] : text, timestamp });
      // 兜底：模型说了“我来做…”却没调用任何工具就结束了，提醒一次让它直接执行
    } else if (messages.at(-1)?.role === "user" || messages.at(-1)?.role === "toolResult") {
      await agent.continue();
    }
    // 兜底：模型说了“我来做…”却没调用工具就结束了，提醒一次让它直接执行
    await drain();
    if (!modelFailure && saidButDidNot(agent.state.messages, timestamp, userRequest)) {
      // 模型有时会在没调用工具时就写“已完成…”：只保留打算那句，避免对话里出现假完成
      const last = agent.state.messages.findLast(message => message.role === "assistant");
      const planned = last ? stripPrematureCompletion(messageText(last)) : "";
      if (last && planned !== messageText(last).trim()) {
        // 整段都是假完成时清空对话里的这条；给模型的上下文保留一句占位，避免空消息被接口拒绝
        (last as { content: unknown }).content = [{ type: "text", text: planned || "好的。" }];
        await store.reviseAssistant(run.id, run.epoch, messageId, planned).catch(() => undefined);
      }
      await agent.prompt({ role: "user", content: `${OBSERVATION}你上一条只说明了打算，没有调用工具，也还没有任何结果。现在直接调用对应工具完成用户的要求，这一步不要输出文字。`, timestamp: Date.now() });
    }
    dependencies.signal?.throwIfAborted();
    await drain();
    await assertDurableWorkAdmission();
    if (modelFailure) throw new CreativeAgentError("MODEL_INCOMPLETE", modelFailure);
    closeEarly("未执行");
    await drain();
    // 模型的工作已完成。仍在渲染的视频（或超时未出完的图片）由后台送达对话和画布，
    // 本轮直接结束，用户可以继续发消息，不用等几分钟。
    await store.finish(run.id, run.epoch, "completed");
  } catch (error) {
    finishThinking(); flush(); closeEarly("未执行"); await eventWrites;
    const current = await store.getRun(run.id).catch(() => null);
    if (current && current.epoch !== run.epoch && !current.workerId && ["waiting_decision", "waiting_action"].includes(current.status)) return;
    if (error instanceof HttpError && error.code === "run_deferred") return;
    if (error instanceof MaintenanceSubmissionError) {
      await store.control(run.id, run.actorUserId, `maintenance:${run.id}:${run.epoch}`, "pause", run.epoch).catch(() => undefined);
      throw error;
    }
    const message = error instanceof CreativeAgentError || error instanceof HttpError ? error.message : "Agent 执行中断，已保存已完成的成果。";
    // 步数到上限不算失败：按手动停止处理，用户点 ▶ 继续执行 就从停下的地方接着做
    if (error instanceof CreativeAgentError && error.code === "MODEL_CALL_LIMIT") { await store.finish(run.id, run.epoch, "stopped", message); return; }
    await store.finish(run.id, run.epoch, "failed", message);
    throw error;
  } finally {
    clearTimeout(deltaTimer);
    await eventWrites;
    dependencies.signal?.removeEventListener("abort", abort);
    agent?.abort();
  }
}
