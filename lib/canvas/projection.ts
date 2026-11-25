import { createEmptyCanvasDocumentV2, type CanvasEdge, type CanvasNode, type CanvasSettings } from "@/lib/canvas/document";
import { applyCanvasOperations, type CanvasOperation } from "@/lib/canvas/operations";

export type CanvasProjectionRequirements = {
  nodeIds: string[];
  edgeIds: string[];
  incidentEdgeNodeIds: string[];
  needsEdgeEndpointHydration: boolean;
};

export type CanvasProjectionSlice = {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  settings: CanvasSettings;
};

export type CanvasProjectionChanges = {
  nodeUpserts: CanvasNode[];
  nodeDeletes: string[];
  edgeUpserts: CanvasEdge[];
  edgeDeletes: string[];
  settings: CanvasSettings;
  nodeCountDelta: number;
  edgeCountDelta: number;
};

export function collectCanvasProjectionRequirements(operations: readonly CanvasOperation[]): CanvasProjectionRequirements {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const incidentEdgeNodeIds = new Set<string>();
  let needsEdgeEndpointHydration = false;

  for (const operation of operations) {
    if (operation.kind === "node.create") {
      nodeIds.add(operation.node.id);
      if (operation.node.parentId) nodeIds.add(operation.node.parentId);
    } else if (
      operation.kind === "node.patch"
      || operation.kind === "node.move"
      || operation.kind === "node.resize"
      || operation.kind === "node.reparent"
      || operation.kind === "node.delete"
    ) {
      nodeIds.add(operation.nodeId);
      if (operation.kind === "node.reparent" && operation.parentId) nodeIds.add(operation.parentId);
      if (
        operation.kind === "node.move"
        || operation.kind === "node.resize"
        || operation.kind === "node.reparent"
        || operation.kind === "node.delete"
      ) incidentEdgeNodeIds.add(operation.nodeId);
    } else if (operation.kind === "edge.create") {
      edgeIds.add(operation.edge.id);
      nodeIds.add(operation.edge.source);
      nodeIds.add(operation.edge.target);
    } else if (operation.kind === "edge.patch") {
      edgeIds.add(operation.edgeId);
      if (operation.patch.source) nodeIds.add(operation.patch.source);
      if (operation.patch.target) nodeIds.add(operation.patch.target);
      needsEdgeEndpointHydration = true;
    } else if (operation.kind === "edge.delete") {
      edgeIds.add(operation.edgeId);
    }
  }

  return {
    nodeIds: [...nodeIds].sort(),
    edgeIds: [...edgeIds].sort(),
    incidentEdgeNodeIds: [...incidentEdgeNodeIds].sort(),
    needsEdgeEndpointHydration,
  };
}

export function applyCanvasProjectionOperations(
  projection: CanvasProjectionSlice,
  operations: readonly CanvasOperation[],
): CanvasProjectionChanges {
  const beforeNodeIds = new Set(projection.nodes.map((node) => node.id));
  const beforeEdgeIds = new Set(projection.edges.map((edge) => edge.id));
  const changedNodeIds = new Set<string>();
  const changedEdgeIds = new Set<string>();
  const spatiallyChangedNodeIds = new Set<string>();

  for (const operation of operations) {
    if (operation.kind === "node.create") changedNodeIds.add(operation.node.id);
    else if (operation.kind === "node.patch" || operation.kind === "node.delete") changedNodeIds.add(operation.nodeId);
    else if (operation.kind === "node.move" || operation.kind === "node.resize" || operation.kind === "node.reparent") {
      changedNodeIds.add(operation.nodeId);
      spatiallyChangedNodeIds.add(operation.nodeId);
    }
    else if (operation.kind === "edge.create") changedEdgeIds.add(operation.edge.id);
    else if (operation.kind === "edge.patch" || operation.kind === "edge.delete") changedEdgeIds.add(operation.edgeId);
  }

  const next = applyCanvasOperations({
    ...createEmptyCanvasDocumentV2(),
    nodes: projection.nodes,
    edges: projection.edges,
    settings: projection.settings,
  }, operations);
  const afterNodeIds = new Set(next.nodes.map((node) => node.id));
  const afterEdgeIds = new Set(next.edges.map((edge) => edge.id));
  for (const edge of next.edges) {
    if (spatiallyChangedNodeIds.has(edge.source) || spatiallyChangedNodeIds.has(edge.target)) changedEdgeIds.add(edge.id);
  }

  const nodeDeletes = [...beforeNodeIds].filter((id) => !afterNodeIds.has(id)).sort();
  const edgeDeletes = [...beforeEdgeIds].filter((id) => !afterEdgeIds.has(id)).sort();

  return {
    nodeUpserts: [...changedNodeIds]
      .map((id) => next.nodes.find((node) => node.id === id))
      .filter((node): node is CanvasNode => Boolean(node)),
    nodeDeletes,
    edgeUpserts: [...changedEdgeIds]
      .map((id) => next.edges.find((edge) => edge.id === id))
      .filter((edge): edge is CanvasEdge => Boolean(edge)),
    edgeDeletes,
    settings: next.settings,
    nodeCountDelta: afterNodeIds.size - beforeNodeIds.size,
    edgeCountDelta: afterEdgeIds.size - beforeEdgeIds.size,
  };
}
