import type { CanvasDocumentV2, CanvasMediaIdentity, CanvasNode, CanvasNodeData } from "@/lib/canvas/document";
import type { CanvasHistory } from "@/lib/canvas/history";
import { DEFAULT_CANVAS_AUDIO_NODE_SIZE } from "@/lib/canvas/media-size";
import { syncCanvasTaskAssetChanges } from "@/lib/canvas/task-references";

export type CanvasMediaKind = "image" | "video" | "audio";

export type CanvasPendingUploadResult =
  | { status: "success"; url: string; kind: CanvasMediaKind; mediaId: string; variants?: CanvasMediaIdentity["variants"] }
  | { status: "failed" };

function nodeMediaUrls(data: CanvasNodeData): string[] {
  if (data.kind === "image" || data.kind === "video" || data.kind === "audio") return [data.url];
  if (data.kind === "imageTask") return data.task.references.map((reference) => reference.url);
  if (data.kind === "videoTask") return data.mediaPaths;
  if (data.kind === "compare") return [data.beforeUrl, data.afterUrl];
  return [];
}

export function omitPendingCanvasUploads(document: CanvasDocumentV2, pendingIds: ReadonlySet<string>) {
  const omittedIds = new Set(pendingIds);
  for (const node of document.nodes) {
    if (nodeMediaUrls(node.data).some((url) => url.startsWith("blob:"))) omittedIds.add(node.id);
  }
  return removeNodes(document, omittedIds);
}

function removeNodes(document: CanvasDocumentV2, nodeIds: ReadonlySet<string>) {
  if (!nodeIds.size) return document;
  return {
    ...document,
    nodes: document.nodes.filter((node) => !nodeIds.has(node.id)),
    edges: document.edges.filter((edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target)),
  };
}

export function resolveCanvasPendingUpload(
  document: CanvasDocumentV2,
  nodeId: string,
  result: CanvasPendingUploadResult,
  localUrl?: string,
) {
  const matchingIds = new Set(document.nodes.filter((node) => localUrl
    ? nodeMediaUrls(node.data).includes(localUrl)
    : node.id === nodeId).map((node) => node.id));
  if (!matchingIds.size) return document;
  if (result.status === "failed") return syncCanvasTaskAssetChanges(document, removeNodes(document, matchingIds));
  return {
    ...document,
    nodes: document.nodes.map((node): CanvasNode => {
      if (!matchingIds.has(node.id)) return node;
      if (node.data.kind === "imageTask") {
        return { ...node, data: { ...node.data, task: { ...node.data.task,
          references: node.data.task.references.map((reference) => reference.url === localUrl
            ? { ...reference, url: result.url }
            : reference),
        } } };
      }
      if (node.data.kind === "videoTask") {
        return { ...node, data: { ...node.data, mediaPaths: node.data.mediaPaths.map((url) => url === localUrl ? result.url : url) } };
      }
      if (node.data.kind === "compare") {
        return { ...node, data: { ...node.data,
          beforeUrl: node.data.beforeUrl === localUrl ? result.url : node.data.beforeUrl,
          afterUrl: node.data.afterUrl === localUrl ? result.url : node.data.afterUrl,
        } };
      }
      if (node.data.kind !== "image" && node.data.kind !== "video" && node.data.kind !== "audio") return node;
      const media = node.data;
      const shared = { url: result.url, origin: media.origin, mediaId: result.mediaId, variants: result.variants, name: media.name, prompt: media.prompt, model: media.model };
      const data: CanvasNodeData = result.kind === "video"
        ? { kind: "video", ...shared, posterUrl: media.kind === "video" ? media.posterUrl : undefined }
        : result.kind === "audio"
          ? {
              kind: "audio",
              ...shared,
              waveformPeaks: media.kind === "audio" ? media.waveformPeaks : undefined,
              durationSeconds: media.kind === "audio" ? media.durationSeconds : undefined,
            }
          : { kind: "image", ...shared };
      return {
        ...node,
        ...(result.kind === "audio" ? DEFAULT_CANVAS_AUDIO_NODE_SIZE : {}),
        type: result.kind,
        data,
      };
    }),
  };
}

export function settleCanvasPendingUpload(
  history: CanvasHistory,
  current: CanvasDocumentV2,
  nodeId: string,
  result: CanvasPendingUploadResult,
  localUrl?: string,
) {
  const pendingUrl = localUrl ?? [current, history.present, ...history.past, ...history.future]
    .flatMap((document) => document.nodes.filter((node) => node.id === nodeId).flatMap((node) => nodeMediaUrls(node.data)))
    .find((url) => url.startsWith("blob:"));
  const transform = (document: CanvasDocumentV2) => resolveCanvasPendingUpload(document, nodeId, result, pendingUrl);
  const document = transform(current);
  return {
    document,
    history: {
      ...history,
      past: history.past.map(transform),
      future: history.future.map(transform),
      present: document,
    },
  };
}
