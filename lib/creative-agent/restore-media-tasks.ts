import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import type { AgentMediaTask } from "./media-task";

export type AgentMediaTaskRecovery = {
  nodeId: string; mediaId: string; url: string;
  generationCanvasId: number; generationTask: AgentMediaTask;
};

/** Apply async metadata only to the same still-existing output, keeping current layout. */
export function restoreCreativeAgentMediaTasks(document: CanvasDocumentV2, canvasId: number, recoveries: AgentMediaTaskRecovery[]): CanvasDocumentV2 {
  const byId = new Map(recoveries.filter(item => item.generationCanvasId === canvasId).map(item => [item.nodeId, item]));
  let changed = false;
  const nodes = document.nodes.map(node => {
    const saved = byId.get(node.id), data = node.data;
    if (!saved || (data.kind !== "image" && data.kind !== "video") || data.origin !== "generated"
      || data.mediaId !== saved.mediaId || data.url !== saved.url) return node;
    const task = saved.generationTask;
    if (data.kind === "image" && task.kind === "imageTask") {
      const output = task.task.batches[0]?.outputs[0];
      if (output?.mediaId !== data.mediaId || output?.url !== data.url) return node;
      changed = true;
      return { ...node, type: task.kind, data: { ...task, title: data.name || task.title, task: { ...task.task,
        batches: task.task.batches.map(batch => ({ ...batch, outputs: batch.outputs.map(item => ({ ...item, name: data.name || item.name,
          width: data.variants?.original?.width ?? item.width, height: data.variants?.original?.height ?? item.height })) })) } } };
    }
    if (data.kind === "video" && task.kind === "videoTask" && task.mediaId === data.mediaId && task.outputUrl === data.url) {
      changed = true;
      return { ...node, type: task.kind, data: { ...task, title: data.name || task.title, outputName: data.name || task.outputName, variants: data.variants || task.variants } };
    }
    return node;
  });
  return changed ? { ...document, nodes } : document;
}
