import type { CanvasDocumentV2, CanvasEdge, CanvasNode } from "@/lib/canvas/document";
import type { CanvasNodePatch, CanvasOperation } from "@/lib/canvas/operations";

type CanvasOperationWithoutId<T = CanvasOperation> = T extends CanvasOperation ? Omit<T, "opId"> : never;

function equal(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function changedNodePatch(before: CanvasNode, after: CanvasNode): CanvasNodePatch | null {
  const beforeData = before.data as unknown as Record<string, unknown>;
  const afterData = after.data as unknown as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  const unsetDataKeys: string[] = [];
  for (const key of beforeData === afterData ? [] : Object.keys(afterData).sort()) {
    if (afterData[key] === undefined) {
      if (key in beforeData) unsetDataKeys.push(key);
    } else if (!equal(beforeData[key], afterData[key])) {
      data[key] = afterData[key];
    }
  }
  for (const key of beforeData === afterData ? [] : Object.keys(beforeData).sort()) {
    if (!(key in afterData)) unsetDataKeys.push(key);
  }
  const patch: CanvasNodePatch = {};
  if (Object.keys(data).length) patch.data = data;
  if (unsetDataKeys.length) patch.unsetDataKeys = unsetDataKeys;
  if (before.hidden !== after.hidden) patch.hidden = after.hidden ?? null;
  if (before.zIndex !== after.zIndex) patch.zIndex = after.zIndex ?? null;
  return Object.keys(patch).length ? patch : null;
}

function incidentTo(edge: CanvasEdge, nodeIds: ReadonlySet<string>): boolean {
  return nodeIds.has(edge.source) || nodeIds.has(edge.target);
}

export function diffCanvasDocumentsToOperations(
  before: CanvasDocumentV2,
  after: CanvasDocumentV2,
  operationPrefix = "diff",
): CanvasOperation[] {
  const settingsPatch: Partial<CanvasDocumentV2["settings"]> = {};
  if (before.settings.snapToGrid !== after.settings.snapToGrid) settingsPatch.snapToGrid = after.settings.snapToGrid;
  if (before.settings.gridSize !== after.settings.gridSize) settingsPatch.gridSize = after.settings.gridSize;
  // Viewport preferences do not mutate the shared graph. Immutable editor
  // snapshots retain these arrays, so camera movement needs no graph traversal.
  if (before.nodes === after.nodes && before.edges === after.edges) {
    return Object.keys(settingsPatch).length
      ? [{ kind: "canvas.settings.patch", patch: settingsPatch, opId: `${operationPrefix}:0` }]
      : [];
  }
  const beforeNodes = new Map(before.nodes.map((node) => [node.id, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.id, node]));
  const beforeEdges = new Map(before.edges.map((edge) => [edge.id, edge]));
  const afterEdges = new Map(after.edges.map((edge) => [edge.id, edge]));
  const replacedNodeIds = new Set<string>();
  for (const [id, node] of beforeNodes) {
    const next = afterNodes.get(id);
    if (next && (node.type !== next.type || node.data.kind !== next.data.kind)) replacedNodeIds.add(id);
  }
  const operations: CanvasOperation[] = [];
  const push = (operation: CanvasOperationWithoutId) => {
    operations.push({ ...operation, opId: `${operationPrefix}:${operations.length}` } as CanvasOperation);
  };

  for (const edge of before.edges) {
    const next = afterEdges.get(edge.id);
    if (!next || !equal(edge, next) || incidentTo(edge, replacedNodeIds)) {
      push({ kind: "edge.delete", edgeId: edge.id });
    }
  }
  for (const node of before.nodes) {
    if (!afterNodes.has(node.id) || replacedNodeIds.has(node.id)) push({ kind: "node.delete", nodeId: node.id });
  }
  for (const [index, node] of after.nodes.entries()) {
    if (!beforeNodes.has(node.id) || replacedNodeIds.has(node.id)) push({ kind: "node.create", node, index });
  }
  for (const node of after.nodes) {
    const previous = beforeNodes.get(node.id);
    if (!previous || previous === node || replacedNodeIds.has(node.id)) continue;
    const patch = changedNodePatch(previous, node);
    if (patch) push({ kind: "node.patch", nodeId: node.id, patch });
    if (!equal(previous.position, node.position)) push({ kind: "node.move", nodeId: node.id, position: node.position });
    if (previous.width !== node.width || previous.height !== node.height) {
      push({ kind: "node.resize", nodeId: node.id, width: node.width ?? null, height: node.height ?? null });
    }
    if (previous.parentId !== node.parentId) push({ kind: "node.reparent", nodeId: node.id, parentId: node.parentId ?? null });
  }
  for (const [index, edge] of after.edges.entries()) {
    const previous = beforeEdges.get(edge.id);
    if (!previous || !equal(previous, edge) || incidentTo(edge, replacedNodeIds)) push({ kind: "edge.create", edge, index });
  }
  if (Object.keys(settingsPatch).length) push({ kind: "canvas.settings.patch", patch: settingsPatch });
  return operations;
}

export function createCanvasDocumentMutation(
  before: CanvasDocumentV2,
  after: CanvasDocumentV2,
  operationPrefix: string,
): { operations: CanvasOperation[]; inverseOperations: CanvasOperation[] } {
  return {
    operations: diffCanvasDocumentsToOperations(before, after, `${operationPrefix}:forward`),
    inverseOperations: diffCanvasDocumentsToOperations(after, before, `${operationPrefix}:inverse`),
  };
}
