import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { getCanvasPrimaryImageOutput } from "@/lib/canvas/image-task";
import type { CreativeAgentReference, CreativeAgentSelection } from "./contracts";

export const creativeAgentReferenceKey = (reference: CreativeAgentReference) => `${reference.nodeId}${reference.outputId ? `:${reference.batchId || ""}:${reference.outputId}` : ""}`;

export function mergeCreativeAgentReferences(selected: CreativeAgentReference[], pinned: CreativeAgentReference[]) {
  const pinnedNodes = new Set(pinned.map(reference => reference.nodeId));
  return [...new Map([...selected.filter(reference => !pinnedNodes.has(reference.nodeId)), ...pinned].map(reference => [creativeAgentReferenceKey(reference), reference])).values()];
}

export function getCreativeAgentSelection(canvasId: number, document: Pick<CanvasDocumentV2, "nodes" | "edges">, nodeIds: readonly string[], edgeIds: readonly string[], allImageOutputs = false, focusedOutput?: { nodeId: string; outputId: string } | null): CreativeAgentSelection {
  const nodes = new Map(document.nodes.map(node => [node.id, node]));
  const selected = [...new Set(nodeIds)].filter(id => nodes.has(id));
  return {
    nodeIds: selected,
    edgeIds: [...new Set(edgeIds)].filter(id => document.edges.some(edge => edge.id === id)),
    references: selected.flatMap(nodeId => {
      const { data } = nodes.get(nodeId)!;
      const label = ("title" in data && data.title) || ("name" in data && data.name) || nodeId;
      const reference: CreativeAgentReference = { canvasId, nodeId, kind: data.kind, label };
      if (data.kind === "imageTask") {
        if (allImageOutputs) return data.task.batches.flatMap(batch => batch.outputs.filter(output => output.status === "success" && output.url).map(output => ({
          ...reference, batchId: batch.id, outputId: output.id, mediaId: output.mediaId, generationId: output.generationId,
        })));
        // 在多图节点里单独选中了一张：引用这一张，标签带上它的序号（与对话里的“第 n 张”一致）
        if (focusedOutput?.nodeId === nodeId) {
          for (const batch of [...data.task.batches].reverse()) {
            const ready = batch.outputs.filter(output => output.status === "success" && output.url);
            const index = ready.findIndex(output => output.id === focusedOutput.outputId);
            if (index < 0) continue;
            const output = ready[index];
            return { ...reference, label: ready.length > 1 ? `${label} ${index + 1}` : label, batchId: batch.id, outputId: output.id, mediaId: output.mediaId, generationId: output.generationId };
          }
        }
        const batch = [...data.task.batches].reverse().find(batch => getCanvasPrimaryImageOutput(batch));
        const output = getCanvasPrimaryImageOutput(batch);
        if (!batch || !output) return [];
        Object.assign(reference, { batchId: batch.id, outputId: output.id, mediaId: output.mediaId, generationId: output.generationId });
      } else if (data.kind === "image" || data.kind === "video" || data.kind === "audio") {
        if (data.mediaId) reference.mediaId = data.mediaId;
      } else if (data.kind === "videoTask" || data.kind === "audioTask") {
        if (data.status !== "success" || !data.outputUrl) return [];
        if (data.requestKey) reference.outputId = data.requestKey;
        if (data.generationId) reference.generationId = data.generationId;
        if ("mediaId" in data && data.mediaId) reference.mediaId = data.mediaId;
      }
      return reference;
    }),
  };
}
