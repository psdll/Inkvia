import type { CanvasDocumentV2, CanvasNode, CanvasNodeData } from "@/lib/canvas/document";

export type CanvasMaterialKind = "image" | "video" | "audio";

const LABELS: Record<CanvasMaterialKind, string> = {
  image: "图片",
  video: "视频",
  audio: "音频",
};

const MEDIA_EXTENSION = /\.(png|jpe?g|webp|gif|avif|bmp|tiff?|svg|heic|heif|mp4|webm|mov|m4v|mkv|avi|mp3|wav|m4a|aac|ogg|flac|opus)$/i;
const MIME_EXTENSIONS: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif",
  "image/avif": "avif", "image/bmp": "bmp", "image/tiff": "tiff", "image/svg+xml": "svg",
  "image/heic": "heic", "image/heif": "heif",
  "video/mp4": "mp4", "video/webm": "webm", "video/quicktime": "mov",
  "video/x-m4v": "m4v", "video/x-matroska": "mkv", "video/x-msvideo": "avi",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-wav": "wav", "audio/mp4": "m4a",
  "audio/aac": "aac", "audio/ogg": "ogg", "audio/flac": "flac", "audio/opus": "opus", "audio/webm": "webm",
};

export function getCanvasMediaDownloadName(
  item: { name?: string; url: string; kind: CanvasMaterialKind },
  mimeType = "",
): string {
  const name = item.name || `${item.kind}-${Date.now()}`;
  if (MEDIA_EXTENSION.test(name)) return name;
  const extension = item.url.split(/[?#]/)[0].match(MEDIA_EXTENSION)?.[1]
    || MIME_EXTENSIONS[mimeType.split(";")[0].trim().toLowerCase()]
    || (item.kind === "video" ? "mp4" : item.kind === "audio" ? "mp3" : "png");
  return `${name}.${extension}`;
}

function successfulImageOutputs(document: CanvasDocumentV2) {
  return document.nodes.flatMap((node, nodeIndex) => {
    if (node.data.kind !== "imageTask") return [];
    return node.data.task.batches.flatMap((batch, batchIndex) => batch.outputs.flatMap((output, outputIndex) => (
      output.status === "success" && output.url && !output.name
        ? [{
            key: `${node.id}:${batch.id}:${output.id}`,
            createdAt: batch.createdAt,
            nodeIndex,
            batchIndex,
            outputIndex,
          }]
        : []
    )));
  }).sort((left, right) => (
    left.createdAt - right.createdAt
    || left.nodeIndex - right.nodeIndex
    || left.batchIndex - right.batchIndex
    || left.outputIndex - right.outputIndex
  ));
}

function taskGeneratedMediaNodes(document: CanvasDocumentV2, kind: CanvasMaterialKind): CanvasNode[] {
  const taskKind = kind === "image" ? "imageTask" : kind === "video" ? "videoTask" : null;
  if (!taskKind) return [];
  const taskIds = new Set(document.nodes.filter((node) => node.data.kind === taskKind).map((node) => node.id));
  const targetIds = new Set(document.edges.filter((edge) => taskIds.has(edge.source)).map((edge) => edge.target));
  return document.nodes.filter((node) => node.data.kind === kind && targetIds.has(node.id));
}

function parseOrdinal(name: string | undefined, kind: CanvasMaterialKind): number {
  const match = String(name || "").match(new RegExp(`^${LABELS[kind]}节点(\\d+)$`));
  return match ? Number(match[1]) : 0;
}

export function getCanvasImageOutputName(
  document: CanvasDocumentV2,
  nodeId: string,
  batchId: string,
  outputId: string,
): string | undefined {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  const output = node?.data.kind === "imageTask"
    ? node.data.task.batches.find((batch) => batch.id === batchId)?.outputs.find((candidate) => candidate.id === outputId)
    : undefined;
  if (node?.data.kind === "imageTask" && node.data.title?.trim()) return node.data.title.trim();
  if (output?.status === "success" && output.url && output.name) return output.name;
  if (output?.status === "success" && output.url && node?.data.kind === "imageTask" && node.data.task.preset === "characterSheet") return "角色设定图";
  if (output?.status === "success" && output.url && node?.data.kind === "imageTask" && node.data.task.angleSource) return "多角度";
  const key = `${nodeId}:${batchId}:${outputId}`;
  const index = successfulImageOutputs(document).findIndex((output) => output.key === key);
  return index >= 0 ? `${LABELS.image}节点${index + 1}` : undefined;
}

export function getNextCanvasMaterialName(document: CanvasDocumentV2, kind: CanvasMaterialKind): string {
  const storedMaximum = document.nodes.reduce((maximum, node) => {
    if (node.data.kind !== kind) return maximum;
    return Math.max(maximum, parseOrdinal(node.data.name, kind));
  }, 0);
  const generatedCount = taskGeneratedMediaNodes(document, kind).length
    + (kind === "image" ? successfulImageOutputs(document).length : 0);
  return `${LABELS[kind]}节点${Math.max(storedMaximum, generatedCount) + 1}`;
}

export function getCanvasMediaNodeName(document: CanvasDocumentV2, nodeId: string): string | undefined {
  const node = document.nodes.find((candidate) => candidate.id === nodeId);
  if (!node || (node.data.kind !== "image" && node.data.kind !== "video" && node.data.kind !== "audio")) return undefined;
  if (node.data.name && node.data.name !== "生成结果") return node.data.name;
  const generatedNodes = taskGeneratedMediaNodes(document, node.data.kind);
  const generatedIndex = generatedNodes.findIndex((candidate) => candidate.id === node.id);
  if (generatedIndex >= 0) {
    const embeddedOutputCount = node.data.kind === "image" ? successfulImageOutputs(document).length : 0;
    return `${LABELS[node.data.kind]}节点${embeddedOutputCount + generatedIndex + 1}`;
  }
  const ordinal = document.nodes.filter((candidate) => candidate.data.kind === node.data.kind).findIndex((candidate) => candidate.id === node.id) + 1;
  return ordinal > 0 ? `${LABELS[node.data.kind]}节点${ordinal}` : undefined;
}

export function getCanvasMediaCopyName(document: CanvasDocumentV2, nodeId: string): string | undefined {
  const name = getCanvasMediaNodeName(document, nodeId);
  return name ? getCanvasCopyName(name) : undefined;
}

export function getCanvasCopyName(name: string): string {
  const extension = name.match(MEDIA_EXTENSION)?.[0] || "";
  return `${name.slice(0, name.length - extension.length)} - 副本${extension}`;
}

export function getCanvasTaskGeneratedMediaName(
  document: CanvasDocumentV2,
  taskId: string,
  url: string,
  kind: CanvasMaterialKind,
): string | undefined {
  const task = document.nodes.find((node) => node.id === taskId);
  if ((task?.data.kind === "videoTask" || task?.data.kind === "audioTask") && task.data.title?.trim()) return task.data.title.trim();
  if (kind === "video" && task?.data.kind === "videoTask" && task.data.outputUrl === url && task.data.outputName) return task.data.outputName;
  if (kind === "audio" && task?.data.kind === "audioTask" && task.data.outputUrl === url && task.data.outputName && task.data.outputName !== "生成音频") return task.data.outputName;
  const targetIds = new Set(document.edges.filter((edge) => edge.source === taskId).map((edge) => edge.target));
  const outputNode = document.nodes.filter((node) => node.data.kind === kind && targetIds.has(node.id) && node.data.url === url).at(-1);
  if (outputNode) return getCanvasMediaNodeName(document, outputNode.id);
  if (kind === "audio") {
    const completedTasks = document.nodes
      .filter((node) => node.data.kind === "audioTask" && node.data.status === "success" && node.data.outputUrl && (!node.data.outputName || node.data.outputName === "生成音频"))
      .sort((left, right) => (
        (left.data.kind === "audioTask" ? left.data.finishedAt || left.data.startedAt || 0 : 0)
        - (right.data.kind === "audioTask" ? right.data.finishedAt || right.data.startedAt || 0 : 0)
      ));
    const index = completedTasks.findIndex((node) => node.id === taskId);
    return index >= 0 ? `${LABELS.audio}节点${index + 1}` : undefined;
  }
  if (kind !== "video") return undefined;
  const completedTasks = document.nodes
    .filter((node) => node.data.kind === "videoTask" && node.data.status === "success" && node.data.outputUrl && !node.data.outputName)
    .sort((left, right) => (
      (left.data.kind === "videoTask" ? left.data.finishedAt || left.data.startedAt || 0 : 0)
      - (right.data.kind === "videoTask" ? right.data.finishedAt || right.data.startedAt || 0 : 0)
    ));
  const index = completedTasks.findIndex((node) => node.id === taskId);
  return index >= 0 ? `${LABELS.video}节点${index + 1}` : undefined;
}

// A task's title belongs to the node, so rerunning it cannot reset a custom name.
export function renameCanvasNodeData(data: CanvasNodeData, value: string): CanvasNodeData {
  const name = value.trim();
  if (!name) return data;
  if (data.kind === "image" || data.kind === "video" || data.kind === "audio") {
    return data.name === name ? data : { ...data, name };
  }
  return data.title === name ? data : { ...data, title: name };
}
