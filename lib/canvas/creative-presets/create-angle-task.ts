import type { CanvasDocumentV2, CanvasNode } from "@/lib/canvas/document";
import type { CanvasImageTaskSettings } from "@/lib/canvas/image-task";
import { getCanvasTaskResultFrameSize } from "@/lib/canvas/task-references";
import { getCanvasConnectionDecision } from "@/lib/canvas/connection-rules";
import { CANVAS_LOCAL_UPLOAD_GAP, getCanvasLocalUploadPositions } from "@/lib/canvas/material-placement";
import { DEFAULT_CANVAS_MEDIA_NODE_SIZE } from "@/lib/canvas/media-size";
import { canvasNodeWorldPosition } from "@/lib/canvas/spatial-index";
import { fitCanvasGroupBounds } from "@/lib/canvas/group-layout";
import { imageAngleSchema, type ImageAngle } from "./types";

export function createCanvasAngleTask(document: CanvasDocumentV2, input: {
  sourceId: string; url: string; angle: ImageAngle; settings: CanvasImageTaskSettings;
  nodeId: string; edgeId: string; prompt?: string;
}) {
  const source = document.nodes.find(node => node.id === input.sourceId);
  const sourceHasImage = source?.data.kind === "image" ? source.data.url === input.url
    : source?.data.kind === "imageTask" && source.data.task.batches.some(batch => batch.outputs.some(output => output.status === "success" && output.url === input.url));
  if (!source || !sourceHasImage || !input.url || input.url.startsWith("blob:")) throw new Error("原图尚未准备好，请完成上传或生成后再试。");
  const mediaId = source.data.kind === "image" ? source.data.mediaId : source.data.kind === "imageTask"
    ? source.data.task.batches.flatMap(batch => batch.outputs).find(output => output.url === input.url)?.mediaId : undefined;
  const angle = imageAngleSchema.parse(input.angle);
  const data = { kind: "imageTask" as const, task: {
    references: [], batches: [], angleSource: { sourceNodeId: source.id, url: input.url, mediaId },
    settings: { ...input.settings, prompt: input.prompt || "", creativePresets: undefined, imageAngle: angle, count: 1 },
  } };
  const size = getCanvasTaskResultFrameSize(data);
  const byId = new Map(document.nodes.map(node => [node.id, node]));
  const sourcePosition = canvasNodeWorldPosition(source, byId);
  const ancestors = new Set<string>();
  for (let parentId = source.parentId; parentId && !ancestors.has(parentId); parentId = byId.get(parentId)?.parentId) ancestors.add(parentId);
  // Resolve world coordinates before excluding the source's own group containers.
  const occupied = document.nodes.map(node => ({
    ...node, position: canvasNodeWorldPosition(node, byId), parentId: undefined,
  })).filter(node => !ancestors.has(node.id));
  const [position] = getCanvasLocalUploadPositions([size], {
    x: sourcePosition.x + (source.width ?? DEFAULT_CANVAS_MEDIA_NODE_SIZE.width) + CANVAS_LOCAL_UPLOAD_GAP,
    y: sourcePosition.y,
  }, occupied);
  const node: CanvasNode = { id: input.nodeId, type: "imageTask", parentId: source.parentId,
    position: { x: position.x - (sourcePosition.x - source.position.x), y: position.y - (sourcePosition.y - source.position.y) }, data, ...size };
  const nodes = source.parentId ? fitCanvasGroupBounds([...document.nodes, node], [source.parentId], true) : [...document.nodes, node];
  const decision = getCanvasConnectionDecision(nodes, { source: source.id, target: node.id }, document.edges);
  if (!decision.allowed) throw new Error(decision.error || "无法连接原图。");
  return { ...document, nodes, edges: [...document.edges, { id: input.edgeId, source: source.id, target: node.id, type: "default" as const }] };
}
