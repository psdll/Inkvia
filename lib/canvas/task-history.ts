import type { CanvasDocumentV2, CanvasNode, CanvasNodeData } from "@/lib/canvas/document";

const executionKeys = [
  "status", "requestKey", "generationId", "startedAt", "finishedAt", "error",
  "outputUrl", "outputName", "mediaId", "variants", "waveformPeaks",
  "durationSeconds", "usageCharacters", "output", "audioOutputs", "selectedAudioIndex",
] as const;

function isActive(data: CanvasNodeData): boolean {
  if (data.kind === "imageTask") {
    return data.task.batches.some(batch => batch.outputs.some(output =>
      output.status === "submitting" || output.status === "running"));
  }
  return "status" in data && (data.status === "submitting" || data.status === "running");
}

function preserveExecution(snapshot: CanvasNodeData, current: CanvasNodeData): CanvasNodeData {
  if (snapshot.kind !== current.kind) return isActive(current) ? current : snapshot;
  // A submitted task's inputs and execution belong together until it finishes.
  if (isActive(current)) return current;
  if (snapshot.kind === "imageTask" && current.kind === "imageTask") {
    return { ...snapshot, task: { ...snapshot.task, batches: current.task.batches } };
  }
  if (!("status" in current)) return snapshot;
  const data = { ...snapshot } as unknown as Record<string, unknown>;
  const runtime = current as unknown as Record<string, unknown>;
  for (const key of executionKeys) {
    if (Object.prototype.hasOwnProperty.call(runtime, key)) data[key] = runtime[key];
    else delete data[key];
  }
  return data as CanvasNodeData;
}

/** History restores user edits, never a previous state of an external task. */
export function preserveCanvasTaskExecutions(
  snapshot: CanvasDocumentV2,
  current: CanvasDocumentV2,
): CanvasDocumentV2 {
  const currentNodes = new Map(current.nodes.map(node => [node.id, node]));
  const nodes = snapshot.nodes.map(node => {
    const live = currentNodes.get(node.id);
    if (!live || (live.data.kind !== "imageTask" && !("status" in live.data))) return node;
    return { ...node, data: preserveExecution(node.data, live.data) };
  });
  const restored = new Map(nodes.map(node => [node.id, node]));
  const retainedIds = new Set<string>();
  // Undoing node/group creation must not remove the owner of an in-flight task.
  function retain(node: CanvasNode) {
    if (restored.has(node.id)) return;
    restored.set(node.id, node);
    if (node.parentId) {
      const parent = currentNodes.get(node.parentId);
      if (parent) retain(parent);
    }
    nodes.push(node);
    retainedIds.add(node.id);
  }
  for (const node of current.nodes) if (isActive(node.data)) retain(node);
  const edgeIds = new Set(snapshot.edges.map(edge => edge.id));
  const retainedEdges = current.edges.filter(edge => !edgeIds.has(edge.id)
    && (retainedIds.has(edge.source) || retainedIds.has(edge.target))
    && restored.has(edge.source) && restored.has(edge.target));
  if (!retainedIds.size && nodes.every((node, index) => node === snapshot.nodes[index])) return snapshot;
  return { ...snapshot, nodes, edges: [...snapshot.edges, ...retainedEdges] };
}
