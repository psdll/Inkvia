import type { CanvasDocumentV2, CanvasNode } from "@/lib/canvas/document";

export function normalizeDeletedGenerationIds(values: Iterable<unknown>) {
  return new Set(Array.from(values, (value) => Number(value)).filter((value) => Number.isSafeInteger(value) && value > 0));
}

export function filterDeletedGenerationItems<T extends { id: number | string }>(items: T[], deletedIds: Iterable<unknown>) {
  const deleted = normalizeDeletedGenerationIds(deletedIds);
  if (!deleted.size) return items;
  return items.filter((item) => !deleted.has(Number(item.id)));
}

function toolResultGenerationId(result: any) {
  return Number(result?.data?.generationId || result?.data?.generation?.id || 0);
}

export function filterDeletedToolResults<T>(results: T[], deletedIds: Iterable<unknown>) {
  const deleted = normalizeDeletedGenerationIds(deletedIds);
  if (!deleted.size) return results;
  return results.filter((result) => !deleted.has(toolResultGenerationId(result)));
}

export function pruneImageBatchOrphanedSuccessItems<
  T extends { outputs: Array<{ status?: string | null; generation?: unknown | null }> },
>(items: T[]) {
  return items.filter((item) => !item.outputs.some((output) => (
    String(output.status || "").toLowerCase() === "success" && !output.generation
  )));
}

export function pruneCanvasDeletedGenerations(document: CanvasDocumentV2, deletedIds: Iterable<unknown>): CanvasDocumentV2 {
  const deleted = normalizeDeletedGenerationIds(deletedIds);
  if (!deleted.size) return document;
  const removedNodeIds = new Set<string>();
  let changed = false;
  const nodes: CanvasNode[] = [];

  for (const node of document.nodes) {
    if ((node.data.kind === "videoTask" || node.data.kind === "audioTask") && deleted.has(Number(node.data.generationId))) {
      removedNodeIds.add(node.id);
      changed = true;
      continue;
    }
    if (node.data.kind !== "imageTask") {
      nodes.push(node);
      continue;
    }
    const batches = node.data.task.batches.filter((batch) => (
      !batch.outputs.some((output) => deleted.has(Number(output.generationId)))
    ));
    if (batches.length === node.data.task.batches.length) {
      nodes.push(node);
      continue;
    }
    changed = true;
    if (!batches.length) {
      removedNodeIds.add(node.id);
      continue;
    }
    nodes.push({
      ...node,
      data: { ...node.data, task: { ...node.data.task, batches } },
    });
  }

  if (!changed) return document;
  return {
    ...document,
    nodes,
    edges: removedNodeIds.size
      ? document.edges.filter((edge) => !removedNodeIds.has(edge.source) && !removedNodeIds.has(edge.target))
      : document.edges,
  };
}
