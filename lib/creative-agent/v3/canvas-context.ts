import "server-only";

import type { CanvasNode } from "@/lib/canvas/document";
import { getCanvasPrimaryImageOutput } from "@/lib/canvas/image-task";
import { creativeAgentNodeHash, type AgentCanvasSnapshot } from "../canvas-tools";
import type { CreativeAgentReference } from "../contracts";
import type { CreativeAgentMediaReference } from "../media-capabilities";
import { CreativeAgentError } from "../errors";

/**
 * 画布节点的短编号：取节点 ID 前 6 位（冲突时加长）。
 * 模型只写短编号，节点 ID、语义哈希与输出版本都由服务端解析，模型不接触。
 */
export function canvasAliases(nodes: CanvasNode[]) {
  const aliases = new Map<string, string>();
  const compact = (id: string) => id.replace(/-/g, "").toLowerCase();
  for (const node of nodes) {
    let length = 6;
    let alias = compact(node.id).slice(0, length);
    while ([...aliases.values()].includes(alias) && length < 32) alias = compact(node.id).slice(0, ++length);
    aliases.set(node.id, alias);
  }
  return aliases;
}

const clip = (value: string | undefined, max: number) => {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
};

export type MediaNodeInfo = { kind: "image" | "video" | "audio"; ready: boolean; name: string; prompt?: string; ratio?: string; model?: string; /** 一个节点里有几张图（如 Midjourney 一次 4 张） */ count?: number };

/** 图片任务节点最近一批已出好的图 */
function readyOutputs(node: CanvasNode) {
  if (node.data.kind !== "imageTask") return [];
  const batch = [...node.data.task.batches].reverse().find(item => getCanvasPrimaryImageOutput(item));
  return batch ? batch.outputs.filter(output => output.status === "success" && output.url).map(output => ({ batch, output })) : [];
}

/** 节点是否包含可作为参考的媒体，以及展示用信息 */
export function mediaNodeInfo(node: CanvasNode): MediaNodeInfo | null {
  const data = node.data;
  if (data.kind === "image") return { kind: "image", ready: Boolean(data.url && !data.url.startsWith("blob:")), name: data.name || "图片", prompt: data.prompt, model: data.model };
  if (data.kind === "video") return { kind: "video", ready: Boolean(data.url && !data.url.startsWith("blob:")), name: data.name || "视频", prompt: data.prompt, model: data.model };
  if (data.kind === "audio") return { kind: "audio", ready: Boolean(data.url && !data.url.startsWith("blob:")), name: data.name || "音频", prompt: data.prompt, model: data.model };
  if (data.kind === "imageTask") {
    const batch = [...data.task.batches].reverse().find(item => getCanvasPrimaryImageOutput(item));
    const latest = data.task.batches.at(-1);
    const count = readyOutputs(node).length;
    return { kind: "image", ready: Boolean(batch), name: data.title || "图片", prompt: (batch ?? latest)?.settings.prompt || data.task.settings.prompt, ratio: (batch ?? latest)?.settings.aspectRatio, model: (batch ?? latest)?.settings.model, ...(count > 1 ? { count } : {}) };
  }
  if (data.kind === "videoTask") return { kind: "video", ready: data.status === "success" && Boolean(data.outputUrl), name: data.title || "视频", prompt: data.prompt, ratio: data.ratio, model: data.model };
  if (data.kind === "audioTask") return { kind: "audio", ready: data.status === "success" && Boolean(data.outputUrl), name: data.title || "音频" };
  return null;
}

function nodeLine(node: CanvasNode, alias: string, selected: boolean, latest = false, conversation = false) {
  const data = node.data;
  const mark = `${selected ? "【已选中】" : ""}${conversation ? "【本对话】" : ""}${latest ? "【最新】" : ""}`;
  const media = mediaNodeInfo(node);
  if (media) {
    const kind = media.kind === "image" ? "图片" : media.kind === "video" ? "视频" : "音频";
    const state = media.ready ? (media.count ? `（共 ${media.count} 张，用 #${alias}/1 到 #${alias}/${media.count} 指定其中一张）` : "") : "（生成中或未就绪）";
    const extra = [media.ratio, media.prompt ? `内容：${clip(media.prompt, 60)}` : ""].filter(Boolean).join("，");
    return `#${alias} ${mark}${kind}「${clip(media.name, 24)}」${state}${extra ? ` ${extra}` : ""}`;
  }
  if (data.kind === "prompt") return `#${alias} ${mark}文本「${clip(data.title || "未命名", 24)}」：${clip(data.text, 80)}`;
  if (data.kind === "group") return `#${alias} ${mark}分组「${clip(data.title, 24)}」`;
  if (data.kind === "llm") return `#${alias} ${mark}文本生成节点`;
  return `#${alias} ${mark}${data.kind}`;
}

/** 节点最近一次生成/完成的时间（毫秒）；读取画布返回的顺序不是创建顺序，不能用下标判断新旧 */
export function nodeRecency(node: CanvasNode) {
  const data = node.data;
  if (data.kind === "imageTask") return Math.max(0, ...data.task.batches.flatMap(batch => [batch.createdAt || 0, ...batch.outputs.map(output => output.finishedAt || output.startedAt || 0)]));
  if (data.kind === "videoTask" || data.kind === "audioTask") return Math.max(data.finishedAt || 0, data.startedAt || 0);
  return 0;
}

/**
 * 给 Agent 的画布摘要：选中的排在最前，其次是本对话生成的作品，其余按新到旧，最多列出 limit 个节点。
 * 画布由多个对话共用，【本对话】标记让“第二张”“刚才那张”只在本对话的作品里找，不会拿别的对话的作品当候选。
 */
export function describeCanvas(snapshot: AgentCanvasSnapshot, selectedNodeIds: string[], limit = 40, conversationNodeIds: string[] = []) {
  const aliases = canvasAliases(snapshot.nodes);
  const selected = new Set(selectedNodeIds);
  const conversation = new Set(conversationNodeIds);
  const byRecency = snapshot.nodes.map((node, index) => ({ node, index, time: nodeRecency(node) })).sort((a, b) => b.time - a.time || b.index - a.index).map(item => item.node);
  const ordered = [...byRecency.filter(node => selected.has(node.id)), ...byRecency.filter(node => !selected.has(node.id) && conversation.has(node.id)), ...byRecency.filter(node => !selected.has(node.id) && !conversation.has(node.id))];
  // 最近生成的一张就绪媒体：用户说“刚才那张”“把它改成…”时的默认对象；本对话有作品时只在本对话里找
  const candidates = conversation.size && byRecency.some(node => conversation.has(node.id) && mediaNodeInfo(node)?.ready) ? byRecency.filter(node => conversation.has(node.id)) : byRecency;
  const latest = candidates.find(node => nodeRecency(node) > 0 && mediaNodeInfo(node)?.ready)?.id;
  const lines = ordered.slice(0, limit).map(node => nodeLine(node, aliases.get(node.id)!, selected.has(node.id), node.id === latest, conversation.has(node.id)));
  const rest = ordered.length - lines.length;
  return { aliases, text: lines.length ? `${lines.join("\n")}${rest > 0 ? `\n…另有 ${rest} 个较早的节点，需要时用 read_canvas 查看` : ""}` : "（画布是空的）" };
}

/** 读取单个节点的完整内容（read_canvas 指定编号时用） */
export function describeNodeDetail(node: CanvasNode, alias: string) {
  const data = node.data;
  if (data.kind === "prompt") return `#${alias} 文本「${data.title || "未命名"}」全文：\n${clip(data.text, 6000)}`;
  const media = mediaNodeInfo(node);
  if (media) return `${nodeLine(node, alias, false)}${media.prompt ? `\n完整提示词：${clip(media.prompt, 2000)}` : ""}${media.model ? `\n模型：${media.model}` : ""}`;
  return nodeLine(node, alias, false);
}

/** 把短编号解析为生成工具需要的精确引用 */
export function resolveAlias(snapshot: AgentCanvasSnapshot, aliases: Map<string, string>, value: string, selection: CreativeAgentReference[]): { node: CanvasNode; reference: CreativeAgentMediaReference; info: MediaNodeInfo } {
  // “#编号/2”指定多图节点里的第 2 张
  const [key, part] = value.trim().replace(/^[#@]/, "").toLowerCase().split("/");
  const matches = snapshot.nodes.filter(node => aliases.get(node.id) === key || node.id.toLowerCase() === key || node.id.replace(/-/g, "").toLowerCase().startsWith(key) && key.length >= 6);
  if (matches.length !== 1) throw new CreativeAgentError("REFERENCE_NOT_FOUND", `画布上找不到素材 #${key}，请用画布摘要里的编号`, 400);
  const node = matches[0];
  const info = mediaNodeInfo(node);
  if (!info) throw new CreativeAgentError("REFERENCE_KIND_INVALID", `#${key} 不是图片、视频或音频，不能作为参考素材`, 400);
  if (!info.ready) throw new CreativeAgentError("REFERENCE_NOT_READY", `#${key} 还没有生成完成，暂时不能作为参考`, 400);
  const semanticHash = creativeAgentNodeHash(node);
  if (part) {
    const outputs = readyOutputs(node);
    const picked = outputs[Number(part) - 1];
    if (!picked) throw new CreativeAgentError("REFERENCE_NOT_FOUND", `#${key} 只有 ${outputs.length || 1} 张图，没有第 ${part} 张`, 400);
    return { node, info, reference: { nodeId: node.id, semanticHash, batchId: picked.batch.id, outputId: picked.output.id, ...(picked.output.mediaId ? { mediaId: picked.output.mediaId } : {}), ...(picked.output.generationId ? { generationId: picked.output.generationId } : {}) } };
  }
  // 用户选中时指定的具体输出版本优先
  const chosen = selection.find(reference => reference.nodeId === node.id);
  if (chosen && (!chosen.semanticHash || chosen.semanticHash === semanticHash)) {
    return { node, info, reference: { nodeId: node.id, semanticHash, ...(chosen.batchId ? { batchId: chosen.batchId } : {}), ...(chosen.outputId ? { outputId: chosen.outputId } : {}), ...(chosen.mediaId ? { mediaId: chosen.mediaId } : {}), ...(chosen.generationId ? { generationId: chosen.generationId } : {}) } };
  }
  const data = node.data;
  if (data.kind === "imageTask") {
    const batch = [...data.task.batches].reverse().find(item => getCanvasPrimaryImageOutput(item))!;
    const output = getCanvasPrimaryImageOutput(batch)!;
    return { node, info, reference: { nodeId: node.id, semanticHash, batchId: batch.id, outputId: output.id, ...(output.mediaId ? { mediaId: output.mediaId } : {}), ...(output.generationId ? { generationId: output.generationId } : {}) } };
  }
  return { node, info, reference: { nodeId: node.id, semanticHash } };
}
