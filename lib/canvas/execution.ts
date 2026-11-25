import type { CanvasDocumentV2, CanvasEdge } from "@/lib/canvas/document";
import type { CanvasImageTaskSettings, CanvasTaskBatch, CanvasTaskOutput } from "@/lib/canvas/image-task";
import { createCanvasTaskOutputs, getCanvasPrimaryImageOutput, normalizeCanvasImageQuality } from "@/lib/canvas/image-task";
import type { CanvasGenerationOutput } from "@/lib/canvas/generation-outputs";

export type CanvasNodeInputs = {
  prompts: string[];
  imageUrls: string[];
  videoUrls: string[];
  audioUrls: string[];
};

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function canvasEdgeIdentity(edge: CanvasEdge) {
  return [edge.source, edge.target, edge.sourceHandle || "", edge.targetHandle || "", edge.type || "default"].join("\u0000");
}

export function collapseLegacyVideoResultDuplicates(document: CanvasDocumentV2): CanvasDocumentV2 {
  const nodeById = new Map(document.nodes.map((node) => [node.id, node]));
  const replacementByDuplicateId = new Map<string, string>();

  for (const node of document.nodes) {
    if (node.data.kind !== "videoTask" || node.data.status !== "success" || !node.data.generationId || !node.data.outputUrl) continue;
    const duplicateId = `video-result-${node.id}-${node.data.generationId}`;
    const duplicate = nodeById.get(duplicateId);
    if (duplicate?.data.kind === "video" && duplicate.data.url === node.data.outputUrl) {
      replacementByDuplicateId.set(duplicateId, node.id);
    }
  }

  if (!replacementByDuplicateId.size) return document;

  const unaffectedEdgeIdentities = new Set(document.edges.flatMap((edge) => (
    replacementByDuplicateId.has(edge.source) || replacementByDuplicateId.has(edge.target)
      ? []
      : [canvasEdgeIdentity(edge)]
  )));
  const rewrittenEdgeIdentities = new Set<string>();
  const edges: CanvasEdge[] = [];

  for (const edge of document.edges) {
    const source = replacementByDuplicateId.get(edge.source) || edge.source;
    const target = replacementByDuplicateId.get(edge.target) || edge.target;
    if (source === edge.source && target === edge.target) {
      edges.push(edge);
      continue;
    }
    if (source === target) continue;
    const rewritten = { ...edge, source, target };
    const identity = canvasEdgeIdentity(rewritten);
    if (unaffectedEdgeIdentities.has(identity) || rewrittenEdgeIdentities.has(identity)) continue;
    rewrittenEdgeIdentities.add(identity);
    edges.push(rewritten);
  }

  return {
    ...document,
    nodes: document.nodes.filter((node) => !replacementByDuplicateId.has(node.id)),
    edges,
  };
}

export function collectNodeInputs(document: CanvasDocumentV2, nodeId: string): CanvasNodeInputs {
  const sources = document.edges
    .filter((edge) => edge.target === nodeId)
    .map((edge) => document.nodes.find((node) => node.id === edge.source))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  const prompts: string[] = [];
  const imageUrls: string[] = [];
  const videoUrls: string[] = [];
  const audioUrls: string[] = [];
  for (const node of sources) {
    if (node.data.kind === "prompt") prompts.push(node.data.text);
    if (node.data.kind === "llm" && node.data.output) prompts.push(node.data.output);
    if (node.data.kind === "image") imageUrls.push(node.data.url);
    if (node.data.kind === "video") videoUrls.push(node.data.url);
    if (node.data.kind === "audio") audioUrls.push(node.data.url);
    if (node.data.kind === "imageTask") {
      const batch = [...node.data.task.batches].reverse().find(candidate => getCanvasPrimaryImageOutput(candidate));
      const output = getCanvasPrimaryImageOutput(batch);
      if (output?.url) imageUrls.push(output.url);
    }
    if (node.data.kind === "videoTask" && node.data.outputUrl) videoUrls.push(node.data.outputUrl);
    if (node.data.kind === "audioTask" && node.data.outputUrl) audioUrls.push(node.data.outputUrl);
  }
  return { prompts: unique(prompts), imageUrls: unique(imageUrls), videoUrls: unique(videoUrls), audioUrls: unique(audioUrls) };
}

export function createImageTaskBatch(
  settings: CanvasImageTaskSettings,
  createdAt = Date.now(),
  makeId: (prefix: string) => string,
): CanvasTaskBatch {
  return {
    id: makeId("batch"),
    createdAt,
    settings: {
      ...settings,
      quality: normalizeCanvasImageQuality(settings.model, settings.quality),
    },
    outputs: createCanvasTaskOutputs(settings.count, () => makeId("output")),
  };
}

export function updateImageTaskOutput(
  batch: CanvasTaskBatch,
  outputId: string,
  patch: Partial<CanvasTaskOutput>,
): CanvasTaskBatch {
  return {
    ...batch,
    outputs: batch.outputs.map((output) => output.id === outputId ? { ...output, ...patch, id: output.id } : output),
  };
}

export function completeImageTaskOutput(
  batch: CanvasTaskBatch,
  outputId: string,
  results: readonly CanvasGenerationOutput[],
  finishedAt = Date.now(),
): CanvasTaskBatch {
  if (!results.length) return batch;
  return {
    ...batch,
    outputs: batch.outputs.flatMap((output) => output.id !== outputId ? [output] : results.map((result, index) => ({
      ...(index === 0 ? output : { startedAt: output.startedAt }),
      id: index === 0 ? output.id : `${output.id}-result-${index}`,
      status: "success" as const,
      url: result.url,
      width: index === 0 && output.url === result.url ? output.width : undefined,
      height: index === 0 && output.url === result.url ? output.height : undefined,
      generationId: result.generationId ?? (index === 0 ? output.generationId : undefined),
      mediaId: result.mediaId ?? (index === 0 && output.url === result.url ? output.mediaId : undefined),
      generationOutputsResolved: true,
      finishedAt,
      error: undefined,
    }))),
  };
}
