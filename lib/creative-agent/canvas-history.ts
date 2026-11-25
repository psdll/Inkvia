import type { CanvasDocumentV2, CanvasNode, CanvasEdge } from "@/lib/canvas/document";
import type { CanvasHistory } from "@/lib/canvas/history";
import type { CanvasMergeConflict, CanvasMergeResult } from "@/lib/canvas/merge";

function equal(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((item, index) => equal(item, right[index]));
  if (!record(left) || !record(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => equal(left[key], right[key]));
}
function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
function entities(value: unknown): value is { id: string }[] {
  return Array.isArray(value) && value.every(item => record(item) && typeof item.id === "string");
}

// Arrays of identified objects (nodes, edges, batches, outputs) merge by fixed ID.
// Primitive arrays remain atomic: their order is part of their meaning.
function mergeValue(base: unknown, local: unknown, remote: unknown, path: string, conflicts: string[], force = false): unknown {
  if (equal(base, remote) || equal(local, remote)) return local;
  if (equal(base, local)) return remote;
  if (entities(base) && entities(local) && entities(remote)) {
    const ids = [...new Set([...local, ...remote].map(item => item.id))];
    return ids.flatMap(id => {
      const value = mergeValue(base.find(item => item.id === id), local.find(item => item.id === id), remote.find(item => item.id === id), `${path}:${id}`, conflicts, force);
      return value === undefined ? [] : [value];
    });
  }
  if (record(base) && record(local) && record(remote)) {
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      const value = mergeValue(base[key], local[key], remote[key], `${path}.${key}`, conflicts, force);
      if (value !== undefined) result[key] = value;
    }
    return result;
  }
  conflicts.push(path);
  return force ? remote : local;
}

export function mergeCreativeAgentCanvasDocuments(base: CanvasDocumentV2, local: CanvasDocumentV2, remote: CanvasDocumentV2): CanvasMergeResult {
  const conflicts: CanvasMergeConflict[] = [];
  function mergeCollection<T extends CanvasNode | CanvasEdge>(entity: "node" | "edge", before: T[], current: T[], incoming: T[]): T[] {
    return [...new Set([...current, ...incoming].map(item => item.id))].flatMap(id => {
      const a = before.find(item => item.id === id), b = current.find(item => item.id === id), c = incoming.find(item => item.id === id);
      const paths: string[] = [];
      const value = mergeValue(a, b, c, `${entity}:${id}`, paths) as T | undefined;
      if (paths.length) conflicts.push({ key: `${entity}:${id}`, entity, id, base: a, local: value,
        remote: mergeValue(a, b, c, `${entity}:${id}`, [], true) as T | undefined });
      return value ? [value] : [];
    });
  }
  // Agent tools do not edit personal settings or viewport.
  return { document: { ...local, nodes: mergeCollection("node", base.nodes, local.nodes, remote.nodes),
    edges: mergeCollection("edge", base.edges, local.edges, remote.edges) }, conflicts };
}

export function applyCreativeAgentRemoteHistory(history: CanvasHistory, remote: CanvasDocumentV2): { history: CanvasHistory; conflicts: string[] } {
  const before = history.present;
  const conflicts: string[] = [];
  const rebase = (frame: CanvasDocumentV2): CanvasDocumentV2 => {
    const nodes = mergeValue(before.nodes, frame.nodes, remote.nodes, "node", conflicts, true) as CanvasNode[];
    const nodeIds = new Set(nodes.map(node => node.id));
    const edges = (mergeValue(before.edges, frame.edges, remote.edges, "edge", conflicts, true) as CanvasEdge[])
      .filter(edge => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    return { ...frame, nodes, edges };
  };
  const present = { ...remote, viewport: before.viewport, settings: before.settings };
  const sameContent = (a: CanvasDocumentV2, b: CanvasDocumentV2) => equal(a.nodes, b.nodes) && equal(a.edges, b.edges) && equal(a.settings, b.settings);
  const past: CanvasDocumentV2[] = [];
  for (const frame of history.past.map(rebase)) if (!past.length || !sameContent(past[past.length - 1], frame)) past.push(frame);
  if (past.length && sameContent(past[past.length - 1], present)) past.pop();
  const future: CanvasDocumentV2[] = [];
  let previous = present;
  for (const frame of history.future.map(rebase)) {
    if (!sameContent(previous, frame)) { future.push(frame); previous = frame; }
  }
  return { history: { ...history, past, present, future }, conflicts: [...new Set(conflicts)] };
}
