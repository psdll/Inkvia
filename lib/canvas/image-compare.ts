import { getCanvasPrimaryImageOutput } from "./image-task";
import { getCanvasTaskPrimaryFrameSize } from "./task-references";
import type { CanvasDocumentV2, CanvasEdge, CanvasNode, CanvasNodeData } from "./document";
import { getCanvasFlowGeometry } from "./flow-geometry";

/** The first remaining input determines the frame; the second never resizes it. */
export function sizeNewlyConnectedComparisons(previous: CanvasDocumentV2, next: CanvasDocumentV2): CanvasDocumentV2 {
  if (!next.nodes.some(node => node.data.kind === "compare")) return next;
  const previousSources = new Map<string, string>();
  for (const edge of previous.edges) if (!previousSources.has(edge.target)) previousSources.set(edge.target, edge.source);
  const nodesById = new Map(next.nodes.map(node => [node.id, node]));
  const firstSources = new Map<string, string>();
  for (const edge of next.edges) if (!firstSources.has(edge.target)) firstSources.set(edge.target, edge.source);
  let changed = false;
  const nodes = next.nodes.map(node => {
    if (node.data.kind !== "compare") return node;
    const sourceId = firstSources.get(node.id);
    const source = sourceId ? nodesById.get(sourceId) : undefined;
    if (!source) return node;
    const { width, height } = source.data.kind === "imageTask" ? getCanvasTaskPrimaryFrameSize(source.data) : getCanvasFlowGeometry(source);
    const previousSource = previous.nodes.find(item => item.id === previousSources.get(node.id));
    if (previousSource?.id === source.id) {
      const oldSize = previousSource.data.kind === "imageTask" ? getCanvasTaskPrimaryFrameSize(previousSource.data) : getCanvasFlowGeometry(previousSource);
      if (oldSize.width === width && oldSize.height === height) return node;
    }
    if (node.width === width && node.height === height) return node;
    changed = true;
    return { ...node, width, height };
  });
  return changed ? { ...next, nodes } : next;
}

export function canvasCompareImageUrl(data?: CanvasNodeData): string {
  if (data?.kind === "image") return data.variants?.original?.url || data.url;
  if (data?.kind === "imageTask") {
    return getCanvasPrimaryImageOutput(data.task.batches.at(-1))?.url || "";
  }
  return "";
}

/** Edge order fixes left/right identity even while either source is still generating. */
export function getCanvasCompareImages(
  id: string,
  nodes: readonly Pick<CanvasNode, "id" | "data">[],
  edges: readonly Pick<CanvasEdge, "source" | "target">[],
  data: Extract<CanvasNodeData, { kind: "compare" }>,
): [string, string] {
  const inputs = edges.filter(edge => edge.target === id).slice(0, 2);
  if (!inputs.length) return [data.beforeUrl, data.afterUrl];
  return [0, 1].map(index => canvasCompareImageUrl(nodes.find(node => node.id === inputs[index]?.source)?.data)) as [string, string];
}

export function canvasCompareMediaKind(data?: CanvasNodeData): "image" | "video" | null {
  if (data?.kind === "image" || data?.kind === "imageTask") return "image";
  if (data?.kind === "video" || data?.kind === "videoTask") return "video";
  return null;
}

export function getCanvasCompareMedia(
  id: string,
  nodes: readonly Pick<CanvasNode, "id" | "data">[],
  edges: readonly Pick<CanvasEdge, "source" | "target">[],
  data: Extract<CanvasNodeData, { kind: "compare" }>,
): { kind: "image" | "video" | null; before: string; after: string } {
  const inputs = edges.filter(edge => edge.target === id).slice(0, 2);
  if (!inputs.length) return { kind: data.beforeUrl || data.afterUrl ? "image" : null, before: data.beforeUrl, after: data.afterUrl };
  const sources = inputs.map(edge => nodes.find(node => node.id === edge.source)?.data);
  const kind = canvasCompareMediaKind(sources[0]);
  const urls = sources.map(source => {
    if (canvasCompareMediaKind(source) !== kind) return "";
    if (source?.kind === "video") return source.variants?.original?.url || source.url;
    if (source?.kind === "videoTask") return source.outputUrl || "";
    return canvasCompareImageUrl(source);
  });
  return { kind, before: urls[0] || "", after: urls[1] || "" };
}
