import type { CanvasDocumentV2 } from "@/lib/canvas/document";

export type ExecutionScope = { scope: "full" } | { scope: "single" | "downstream"; nodeId: string };

function topologicalOrder(document: CanvasDocumentV2, included: Set<string>): string[] {
  const orderIndex = new Map(document.nodes.map((node, index) => [node.id, index]));
  const incoming = new Map([...included].map((id) => [id, 0]));
  const outgoing = new Map([...included].map((id) => [id, [] as string[]]));
  for (const edge of document.edges) {
    if (!included.has(edge.source) || !included.has(edge.target)) continue;
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
    outgoing.get(edge.source)?.push(edge.target);
  }
  const queue = [...included].filter((id) => incoming.get(id) === 0).sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
  const result: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    result.push(id);
    for (const target of outgoing.get(id) ?? []) {
      incoming.set(target, (incoming.get(target) ?? 1) - 1);
      if (incoming.get(target) === 0) {
        queue.push(target);
        queue.sort((a, b) => (orderIndex.get(a) ?? 0) - (orderIndex.get(b) ?? 0));
      }
    }
  }
  for (const id of included) if (!result.includes(id)) result.push(id);
  return result;
}

export function downstreamNodeIds(document: CanvasDocumentV2, nodeId: string): Set<string> {
  const included = new Set([nodeId]);
  const queue = [nodeId];
  while (queue.length) {
    const source = queue.shift()!;
    for (const edge of document.edges) {
      if (edge.source !== source || included.has(edge.target)) continue;
      included.add(edge.target);
      queue.push(edge.target);
    }
  }
  return included;
}

export function buildExecutionPlan(document: CanvasDocumentV2, target: ExecutionScope): string[] {
  if (target.scope === "single") return document.nodes.some((node) => node.id === target.nodeId) ? [target.nodeId] : [];
  const included = target.scope === "full"
    ? new Set(document.nodes.map((node) => node.id))
    : downstreamNodeIds(document, target.nodeId);
  return topologicalOrder(document, included);
}

export async function executeCanvasLoop<T>(
  items: T[],
  mode: "serial" | "parallel",
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (mode === "serial") {
    for (let index = 0; index < items.length; index += 1) await worker(items[index], index);
    return;
  }
  let cursor = 0;
  const limit = Math.max(1, Math.min(8, Math.floor(concurrency)));
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  }));
}
