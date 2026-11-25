import type { CanvasNode } from "@/lib/canvas/document";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function collectExplicitMediaIds(value: unknown, result: Set<string>, seen: WeakSet<object>) {
  if (!value || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) collectExplicitMediaIds(item, result, seen);
    return;
  }
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key === "mediaId" && typeof item === "string" && UUID_PATTERN.test(item)) result.add(item.toLowerCase());
    else collectExplicitMediaIds(item, result, seen);
  }
}

export function collectCanvasNodeMediaIds(node: CanvasNode): string[] {
  const result = new Set<string>();
  collectExplicitMediaIds(node.data, result, new WeakSet());
  return [...result].sort();
}

export type CanvasCurrentMediaReferenceChange = {
  sourceId: string;
  mediaIds: string[];
};

export function collectCanvasCurrentMediaReferenceChanges(
  canvasId: number,
  nodeUpserts: readonly CanvasNode[],
  nodeDeletes: readonly string[],
): CanvasCurrentMediaReferenceChange[] {
  const changes = new Map<string, string[]>();
  for (const nodeId of nodeDeletes) changes.set(`canvas:${canvasId}:node:${nodeId}`, []);
  for (const node of nodeUpserts) {
    changes.set(`canvas:${canvasId}:node:${node.id}`, collectCanvasNodeMediaIds(node));
  }
  return [...changes].map(([sourceId, mediaIds]) => ({ sourceId, mediaIds })).sort((a, b) => a.sourceId.localeCompare(b.sourceId));
}
