import type { CanvasEdge, CanvasNode, CanvasNodeKind } from "@/lib/canvas/document";
import { isSeedAudioModel } from "@/lib/seed-audio-models";
import { collectCanvasVideoReferences } from "@/lib/canvas/task-references";
import { getCanvasVideoReferenceError } from "@/lib/canvas/video-references";

type CanvasConnection = {
  source?: string | null;
  target?: string | null;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};
type CanvasConnectionEdge = CanvasEdge;
type CanvasConnectionOptions = { ignoreEdgeId?: string };

export type CanvasConnectionPayloadKind = "text" | "image" | "video" | "audio";
export type CanvasConnectionDecision = {
  allowed: boolean;
  error: string | null;
  sourceKind: CanvasNodeKind | null;
  targetKind: CanvasNodeKind | null;
  payloadKind: CanvasConnectionPayloadKind | null;
};

const CANVAS_NODE_LABELS: Record<CanvasNodeKind, string> = {
  image: "图片素材",
  video: "视频素材",
  audio: "音频素材",
  prompt: "提示词",
  imageTask: "图片任务",
  videoTask: "视频任务",
  audioTask: "音频任务",
  llm: "文本任务",
  group: "分组",
  loop: "循环",
  compare: "对比",
  breakdown: "拉片",
};

export const CANVAS_CONNECTION_INPUT_MATRIX = {
  imageTask: ["text", "image"],
  videoTask: ["text", "image", "video", "audio"],
  audioTask: ["text"],
  llm: ["text", "image", "video", "audio"],
} as const satisfies Partial<Record<CanvasNodeKind, readonly CanvasConnectionPayloadKind[]>>;

const CANVAS_USER_SOURCE_KINDS = new Set<CanvasNodeKind>([
  "image",
  "video",
  "audio",
  "prompt",
  "imageTask",
  "videoTask",
  "audioTask",
  "llm",
]);

export const CANVAS_MEDIA_BODY_TARGET_HANDLE_ID = "canvas-media-body-target";
export const CANVAS_MEDIA_INPUT_HANDLE_ID = "canvas-media-input";
export const CANVAS_TASK_BODY_TARGET_HANDLE_ID = "canvas-task-body-target";
export const CANVAS_TASK_INPUT_HANDLE_ID = "canvas-task-input";
export const CANVAS_LEFT_OUTPUT_HANDLE_ID = "canvas-left-output";
export const CANVAS_RIGHT_OUTPUT_HANDLE_ID = "canvas-right-output";

export function getCanvasSelectionConnectionSources<T extends Pick<CanvasNode, "id" | "parentId" | "data">>(nodes: readonly T[], selectedIds: readonly string[]): T[] {
  const selected = new Set(selectedIds);
  const groups = new Map(nodes.filter(node => node.data.kind === "group").map(node => [node.id, node]));
  return nodes.filter(node => {
    if (!CANVAS_USER_SOURCE_KINDS.has(node.data.kind)) return false;
    let current: T | undefined = node;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (selected.has(current.id)) return true;
      visited.add(current.id);
      current = current.parentId ? groups.get(current.parentId) : undefined;
    }
    return false;
  });
}

export function connectCanvasNodeSelection(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasConnectionEdge[],
  sourceIds: readonly string[],
  targetId: string | null,
  createEdgeId: () => string,
) {
  const uniqueSourceIds = [...new Set(sourceIds)];
  const target = nodes.find((node) => node.id === targetId);
  if (!target || uniqueSourceIds.length === 0) return { connected: false, edges: [...edges] };

  const targetHandle = target.data.kind === "image" || target.data.kind === "video" || target.data.kind === "audio"
    ? CANVAS_MEDIA_BODY_TARGET_HANDLE_ID
    : null;
  const additions: CanvasEdge[] = [];

  for (const source of uniqueSourceIds) {
    const candidate = { source, target: target.id, targetHandle };
    const connectionDecision = getCanvasConnectionDecision(nodes, candidate, [...edges, ...additions]);
    if (!connectionDecision.allowed) return { connected: false, edges: [...edges] };
    additions.push({
      id: createEdgeId(),
      source,
      target: target.id,
      targetHandle,
      type: "default",
    });
  }

  return { connected: true, edges: [...edges, ...additions] };
}

export function normalizeCanvasConnectionTargetHandle(targetHandle: string | null | undefined) {
  return targetHandle === CANVAS_TASK_BODY_TARGET_HANDLE_ID || targetHandle === CANVAS_TASK_INPUT_HANDLE_ID ? null : targetHandle ?? null;
}

export function connectCanvasShortcutSelection(
  nodes: readonly CanvasNode[],
  edges: readonly CanvasEdge[],
  selectedIds: readonly string[],
  createEdgeId: () => string,
): { connected: boolean; edges: CanvasEdge[]; error?: string } {
  const selected = [...new Set(selectedIds)].filter((id) => nodes.some((node) => node.id === id && node.type !== "group"));
  const unchanged = { connected: false, edges: [...edges] };
  if (selected.length !== 2) return { ...unchanged, error: "请选择两个可以连接的节点" };
  const [first, second] = selected;
  if (edges.some((edge) => (edge.source === first && edge.target === second) || (edge.source === second && edge.target === first))) {
    return { ...unchanged, error: "这两个节点已连接" };
  }
  for (const [source, target] of [[first, second], [second, first]]) {
    if (!getCanvasConnectionDecision(nodes, { source, target }, edges).allowed) continue;
    const targetNode = nodes.find((node) => node.id === target)!;
    const targetHandle = targetNode.type === "image" || targetNode.type === "video" || targetNode.type === "audio" ? CANVAS_MEDIA_BODY_TARGET_HANDLE_ID : null;
    return { connected: true, edges: [...edges, { id: createEdgeId(), source, target, targetHandle, type: "default" }] };
  }
  return { ...unchanged, error: "这两个节点的类型不支持连线" };
}

function canvasConnectionPayloadKind(node: CanvasNode): CanvasConnectionPayloadKind | null {
  if (node.data.kind === "prompt" || node.data.kind === "llm") return "text";
  if (node.data.kind === "image" || node.data.kind === "imageTask") return "image";
  if (node.data.kind === "video" || node.data.kind === "videoTask") return "video";
  if (node.data.kind === "audio" || node.data.kind === "audioTask") return "audio";
  return null;
}

function decision(
  error: string | null,
  sourceKind: CanvasNodeKind | null,
  targetKind: CanvasNodeKind | null,
  payloadKind: CanvasConnectionPayloadKind | null,
): CanvasConnectionDecision {
  return { allowed: error === null, error, sourceKind, targetKind, payloadKind };
}

export function getCanvasConnectionDecision(
  nodes: readonly CanvasNode[],
  connection: CanvasConnection,
  edges: readonly CanvasConnectionEdge[] = [],
  options: CanvasConnectionOptions = {},
): CanvasConnectionDecision {
  const source = nodes.find((node) => node.id === connection.source);
  const target = nodes.find((node) => node.id === connection.target);
  const sourceKind = source?.data.kind ?? null;
  const targetKind = target?.data.kind ?? null;
  const payloadKind = source ? canvasConnectionPayloadKind(source) : null;

  if (connection.source && !source) return decision("连接起点不存在", sourceKind, targetKind, payloadKind);
  if (connection.target && !target) return decision("连接目标不存在", sourceKind, targetKind, payloadKind);
  if (!source || !target) return decision(null, sourceKind, targetKind, payloadKind);
  const resolvedSourceKind = source.data.kind;
  const resolvedTargetKind = target.data.kind;
  if (source.id === target.id) return decision("节点不能连接自身", sourceKind, targetKind, payloadKind);
  if (source.data.kind === "group" && source.data.stacked) {
    const members = getCanvasSelectionConnectionSources(nodes, [source.id]);
    if (!members.length) return decision("分组内没有可连接的节点", sourceKind, targetKind, payloadKind);
    const pending = [...edges];
    for (const member of members) {
      const result = getCanvasConnectionDecision(nodes, { ...connection, source: member.id }, pending, options);
      if (!result.allowed) return result;
      pending.push({ id: `preview-${member.id}`, source: member.id, target: target.id });
    }
    return decision(null, sourceKind, targetKind, canvasConnectionPayloadKind(members[0]));
  }
  if (edges.some((edge) => (
    edge.id !== options.ignoreEdgeId
    && edge.source === source.id
    && edge.target === target.id
  ))) return decision("这条连线已存在", sourceKind, targetKind, payloadKind);

  if (!CANVAS_USER_SOURCE_KINDS.has(resolvedSourceKind) || !payloadKind) {
    return decision(`${CANVAS_NODE_LABELS[resolvedSourceKind]}节点不能作为连接起点`, sourceKind, targetKind, payloadKind);
  }

  if ((target.data.kind === "image" || target.data.kind === "video" || target.data.kind === "audio") && target.data.origin === "upload") {
    return decision("上传素材只能作为连接起点", sourceKind, targetKind, payloadKind);
  }

  if (resolvedTargetKind === "compare") {
    if (payloadKind !== "image" && payloadKind !== "video") return decision("对比节点只接受图片或视频素材", sourceKind, targetKind, payloadKind);
    const inputs = edges.filter((edge) => edge.target === target.id && edge.id !== options.ignoreEdgeId);
    const firstSource = nodes.find(node => node.id === inputs[0]?.source);
    const firstKind = firstSource ? canvasConnectionPayloadKind(firstSource) : null;
    if (firstKind && firstKind !== payloadKind) return decision(`第一个素材是${firstKind === "video" ? "视频" : "图片"}，请连接同类型素材`, sourceKind, targetKind, payloadKind);
    return decision(inputs.length >= 2 ? "对比节点最多连接两张同类型素材" : null, sourceKind, targetKind, payloadKind);
  }

  if (resolvedTargetKind === "image") {
    const generated = target.data.kind === "image" && target.data.origin === "generated";
    const error = resolvedSourceKind === "imageTask" || (generated && (payloadKind === "image" || payloadKind === "video"))
      ? null : generated ? "该图片节点只接受图片或视频连线" : "图片素材节点只接收图片任务结果";
    return decision(error, sourceKind, targetKind, payloadKind);
  }
  if (resolvedTargetKind === "video") {
    const generated = target.data.kind === "video" && target.data.origin === "generated";
    const error = resolvedSourceKind === "videoTask" || (generated && payloadKind === "video")
      ? null : generated ? "该视频节点只接受视频连线" : "视频素材节点只接收视频任务结果";
    return decision(error, sourceKind, targetKind, payloadKind);
  }
  if (resolvedTargetKind === "audio") {
    const generated = target.data.kind === "audio" && target.data.origin === "generated";
    const error = generated && (resolvedSourceKind === "audioTask" || payloadKind === "audio")
      ? null : generated ? "该音频节点只接受音频连线" : "音频素材节点不接收输入连线";
    return decision(error, sourceKind, targetKind, payloadKind);
  }

  const seedAudioTarget = target.data.kind === "audioTask" && isSeedAudioModel(target.data.model);
  const acceptedInputs: readonly CanvasConnectionPayloadKind[] | undefined = seedAudioTarget
    ? ["text", "image", "audio"]
    : CANVAS_CONNECTION_INPUT_MATRIX[resolvedTargetKind as keyof typeof CANVAS_CONNECTION_INPUT_MATRIX];
  if (!acceptedInputs) {
    return decision(`${CANVAS_NODE_LABELS[resolvedTargetKind]}节点不接收输入连线`, sourceKind, targetKind, payloadKind);
  }
  if (!acceptedInputs.includes(payloadKind)) {
    const error = resolvedTargetKind === "audioTask"
      ? seedAudioTarget ? "Seed Audio 只接收文本、图片或音频输入" : "音频任务只接收文本输入"
      : resolvedTargetKind === "imageTask" && (payloadKind === "audio" || payloadKind === "video")
      ? "音频和视频素材不能连接图片任务"
      : resolvedTargetKind === "llm"
        ? "文本任务只接收文本、图片、视频或音频输入"
        : `${CANVAS_NODE_LABELS[resolvedSourceKind]}不能连接${CANVAS_NODE_LABELS[resolvedTargetKind]}`;
    return decision(error, sourceKind, targetKind, payloadKind);
  }

  if (target.data.kind === "videoTask" && payloadKind !== "text") {
    const references = collectCanvasVideoReferences({ nodes: [...nodes], edges: [
      ...edges.filter(edge => edge.id !== options.ignoreEdgeId),
      { id: "pending-video-reference", source: source.id, target: target.id },
    ] }, target.id);
    const error = getCanvasVideoReferenceError(target.data.model, references);
    if (error) return decision(error, sourceKind, targetKind, payloadKind);
  }
  return decision(null, sourceKind, targetKind, payloadKind);
}

export function getCanvasConnectionError(
  nodes: readonly CanvasNode[],
  connection: CanvasConnection,
  edges: readonly CanvasConnectionEdge[] = [],
  options: CanvasConnectionOptions = {},
): string | null {
  return getCanvasConnectionDecision(nodes, connection, edges, options).error;
}

export function isCanvasConnectionAllowed(
  nodes: readonly CanvasNode[],
  connection: CanvasConnection,
  edges: readonly CanvasConnectionEdge[] = [],
  options: CanvasConnectionOptions = {},
) {
  return getCanvasConnectionDecision(nodes, connection, edges, options).allowed;
}
