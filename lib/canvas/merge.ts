import type { CanvasDocumentV2, CanvasEdge, CanvasNode } from "@/lib/canvas/document";

export type CanvasMergeConflict = {
  key: `node:${string}` | `edge:${string}`;
  entity: "node" | "edge";
  id: string;
  base?: CanvasNode | CanvasEdge;
  local?: CanvasNode | CanvasEdge;
  remote?: CanvasNode | CanvasEdge;
};

export type CanvasMergeResult = {
  document: CanvasDocumentV2;
  conflicts: CanvasMergeConflict[];
};

export type CanvasMergeDecision = "local" | "remote";

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((value, index) => deepEqual(value, right[index]));
  }
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return deepEqual(leftKeys, rightKeys) && leftKeys.every((key) => deepEqual(leftRecord[key], rightRecord[key]));
}

function orderedIds<T extends { id: string }>(...collections: T[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const collection of collections) {
    for (const item of collection) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item.id);
    }
  }
  return result;
}

function mergeEntities<T extends { id: string }>(
  entity: "node" | "edge",
  base: T[],
  local: T[],
  remote: T[],
): { values: T[]; conflicts: CanvasMergeConflict[] } {
  const baseById = new Map(base.map((item) => [item.id, item]));
  const localById = new Map(local.map((item) => [item.id, item]));
  const remoteById = new Map(remote.map((item) => [item.id, item]));
  const values: T[] = [];
  const conflicts: CanvasMergeConflict[] = [];

  for (const id of orderedIds(base, local, remote)) {
    const baseValue = baseById.get(id);
    const localValue = localById.get(id);
    const remoteValue = remoteById.get(id);
    let selected: T | undefined;

    if (deepEqual(localValue, remoteValue)) selected = localValue;
    else if (deepEqual(localValue, baseValue)) selected = remoteValue;
    else if (deepEqual(remoteValue, baseValue)) selected = localValue;
    else {
      selected = localValue;
      conflicts.push({
        key: `${entity}:${id}`,
        entity,
        id,
        base: baseValue,
        local: localValue,
        remote: remoteValue,
      } as CanvasMergeConflict);
    }

    if (selected) values.push(selected);
  }

  return { values, conflicts };
}

function mergeSettings(
  base: CanvasDocumentV2["settings"],
  local: CanvasDocumentV2["settings"],
  remote: CanvasDocumentV2["settings"],
): CanvasDocumentV2["settings"] {
  if (deepEqual(local, base)) return remote;
  return local;
}

export function mergeCanvasDocuments(
  base: CanvasDocumentV2,
  local: CanvasDocumentV2,
  remote: CanvasDocumentV2,
): CanvasMergeResult {
  const nodes = mergeEntities("node", base.nodes, local.nodes, remote.nodes);
  const edges = mergeEntities("edge", base.edges, local.edges, remote.edges);
  return {
    document: {
      schemaVersion: 2,
      mode: "smart",
      nodes: nodes.values,
      edges: edges.values,
      viewport: local.viewport,
      settings: mergeSettings(base.settings, local.settings, remote.settings),
    },
    conflicts: [...nodes.conflicts, ...edges.conflicts],
  };
}

function replaceEntity<T extends { id: string }>(values: T[], id: string, replacement: T | undefined): T[] {
  const index = values.findIndex((item) => item.id === id);
  if (!replacement) return index < 0 ? values : values.filter((item) => item.id !== id);
  if (index < 0) return [...values, replacement];
  return values.map((item) => item.id === id ? replacement : item);
}

export function resolveCanvasMergeConflicts(
  result: CanvasMergeResult,
  decisions: Record<string, CanvasMergeDecision>,
): CanvasDocumentV2 {
  let nodes = result.document.nodes;
  let edges = result.document.edges;
  for (const conflict of result.conflicts) {
    const decision = decisions[conflict.key] ?? "local";
    const selected = conflict[decision];
    if (conflict.entity === "node") nodes = replaceEntity(nodes, conflict.id, selected as CanvasNode | undefined);
    else edges = replaceEntity(edges, conflict.id, selected as CanvasEdge | undefined);
  }
  return { ...result.document, nodes, edges };
}
