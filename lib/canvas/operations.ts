import type {
  CanvasDocumentV2,
  CanvasEdge,
  CanvasNode,
  CanvasNodeData,
  CanvasSettings,
} from "@/lib/canvas/document";
import {
  CANVAS_MAX_MUTATION_BYTES,
  CANVAS_MAX_MUTATION_OPERATIONS,
  CanvasLimitError,
  serializedByteLength,
  validateCanvasDocumentBudget,
  validateCanvasEdgeBudget,
  validateCanvasNodeBudget,
} from "@/lib/canvas/limits";

export const CANVAS_OPERATION_PROTOCOL_VERSION = 1 as const;

export type CanvasNodePatch = {
  data?: Partial<CanvasNodeData> | Record<string, unknown>;
  unsetDataKeys?: string[];
  hidden?: boolean | null;
  zIndex?: number | null;
};

export type CanvasEdgePatch = Partial<Omit<CanvasEdge, "id">>;

export type CanvasOperation =
  | { opId: string; kind: "node.create"; node: CanvasNode; index?: number }
  | { opId: string; kind: "node.patch"; nodeId: string; patch: CanvasNodePatch }
  | { opId: string; kind: "node.move"; nodeId: string; position: { x: number; y: number } }
  | { opId: string; kind: "node.resize"; nodeId: string; width: number | null; height: number | null }
  | { opId: string; kind: "node.reparent"; nodeId: string; parentId: string | null }
  | { opId: string; kind: "node.delete"; nodeId: string }
  | { opId: string; kind: "edge.create"; edge: CanvasEdge; index?: number }
  | { opId: string; kind: "edge.patch"; edgeId: string; patch: CanvasEdgePatch }
  | { opId: string; kind: "edge.delete"; edgeId: string }
  | { opId: string; kind: "canvas.settings.patch"; patch: Partial<CanvasSettings> };

export class CanvasOperationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CanvasOperationError";
  }
}

function fail(code: string, message: string): never {
  throw new CanvasOperationError(code, message);
}

function assertFinitePoint(point: { x: number; y: number }, code: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) fail(code, "position must contain finite coordinates");
}

function findNode(nodes: CanvasNode[], id: string): CanvasNode {
  const node = nodes.find((candidate) => candidate.id === id);
  if (!node) return fail("NODE_NOT_FOUND", `node ${id} does not exist`);
  return node;
}

function findEdge(edges: CanvasEdge[], id: string): CanvasEdge {
  const edge = edges.find((candidate) => candidate.id === id);
  if (!edge) return fail("EDGE_NOT_FOUND", `edge ${id} does not exist`);
  return edge;
}

function replaceNode(nodes: CanvasNode[], node: CanvasNode): CanvasNode[] {
  return nodes.map((candidate) => candidate.id === node.id ? node : candidate);
}

function replaceEdge(edges: CanvasEdge[], edge: CanvasEdge): CanvasEdge[] {
  return edges.map((candidate) => candidate.id === edge.id ? edge : candidate);
}

function validateEdgeEndpoints(nodes: CanvasNode[], edge: Pick<CanvasEdge, "id" | "source" | "target">): void {
  if (!nodes.some((node) => node.id === edge.source)) fail("EDGE_SOURCE_NOT_FOUND", `edge ${edge.id} source does not exist`);
  if (!nodes.some((node) => node.id === edge.target)) fail("EDGE_TARGET_NOT_FOUND", `edge ${edge.id} target does not exist`);
}

function applyOperation(document: CanvasDocumentV2, operation: CanvasOperation): CanvasDocumentV2 {
  if (operation.kind === "node.create") {
    if (document.nodes.some((node) => node.id === operation.node.id)) fail("NODE_ALREADY_EXISTS", `node ${operation.node.id} already exists`);
    if (operation.node.type !== operation.node.data.kind) fail("NODE_KIND_MISMATCH", "node type must match data kind");
    validateCanvasNodeBudget(operation.node);
    const index = operation.index === undefined
      ? document.nodes.length
      : Math.max(0, Math.min(operation.index, document.nodes.length));
    return { ...document, nodes: [...document.nodes.slice(0, index), operation.node, ...document.nodes.slice(index)] };
  }

  if (operation.kind === "node.patch") {
    const current = findNode(document.nodes, operation.nodeId);
    const patchData = operation.patch.data;
    if (patchData && "kind" in patchData && patchData.kind !== undefined && patchData.kind !== current.data.kind) {
      fail("NODE_KIND_IMMUTABLE", `node ${operation.nodeId} kind cannot change`);
    }
    if (operation.patch.unsetDataKeys?.includes("kind")) fail("NODE_KIND_IMMUTABLE", `node ${operation.nodeId} kind cannot change`);
    const nextData = { ...current.data, ...(patchData ?? {}) } as unknown as Record<string, unknown>;
    for (const key of operation.patch.unsetDataKeys ?? []) delete nextData[key];
    const next: CanvasNode = {
      ...current,
      ...((patchData || operation.patch.unsetDataKeys?.length) ? { data: nextData as CanvasNodeData } : {}),
    };
    if (operation.patch.hidden === null) delete next.hidden;
    else if (operation.patch.hidden !== undefined) next.hidden = operation.patch.hidden;
    if (operation.patch.zIndex === null) delete next.zIndex;
    else if (operation.patch.zIndex !== undefined) next.zIndex = operation.patch.zIndex;
    if (next.data.kind !== current.data.kind) fail("NODE_KIND_IMMUTABLE", `node ${operation.nodeId} kind cannot change`);
    validateCanvasNodeBudget(next);
    return { ...document, nodes: replaceNode(document.nodes, next) };
  }

  if (operation.kind === "node.move") {
    assertFinitePoint(operation.position, "NODE_POSITION_INVALID");
    const current = findNode(document.nodes, operation.nodeId);
    const next = { ...current, position: { ...operation.position } };
    validateCanvasNodeBudget(next);
    return { ...document, nodes: replaceNode(document.nodes, next) };
  }

  if (operation.kind === "node.resize") {
    if (
      (operation.width !== null && (!Number.isFinite(operation.width) || operation.width <= 0))
      || (operation.height !== null && (!Number.isFinite(operation.height) || operation.height <= 0))
    ) {
      fail("NODE_SIZE_INVALID", "node size must be finite and positive");
    }
    const current = findNode(document.nodes, operation.nodeId);
    const next = { ...current };
    if (operation.width === null) delete next.width;
    else next.width = operation.width;
    if (operation.height === null) delete next.height;
    else next.height = operation.height;
    validateCanvasNodeBudget(next);
    return { ...document, nodes: replaceNode(document.nodes, next) };
  }

  if (operation.kind === "node.reparent") {
    const current = findNode(document.nodes, operation.nodeId);
    if (operation.parentId === operation.nodeId) fail("NODE_PARENT_CYCLE", "node cannot parent itself");
    if (operation.parentId) {
      const parent = findNode(document.nodes, operation.parentId);
      if (parent.data.kind !== "group") fail("NODE_PARENT_INVALID", "parent node must be a group");
    }
    const next: CanvasNode = operation.parentId
      ? { ...current, parentId: operation.parentId, extent: "parent" }
      : { ...current, parentId: undefined, extent: undefined };
    validateCanvasNodeBudget(next);
    return { ...document, nodes: replaceNode(document.nodes, next) };
  }

  if (operation.kind === "node.delete") {
    findNode(document.nodes, operation.nodeId);
    return {
      ...document,
      nodes: document.nodes.filter((node) => node.id !== operation.nodeId),
      edges: document.edges.filter((edge) => edge.source !== operation.nodeId && edge.target !== operation.nodeId),
    };
  }

  if (operation.kind === "edge.create") {
    if (document.edges.some((edge) => edge.id === operation.edge.id)) fail("EDGE_ALREADY_EXISTS", `edge ${operation.edge.id} already exists`);
    validateEdgeEndpoints(document.nodes, operation.edge);
    validateCanvasEdgeBudget(operation.edge);
    const index = operation.index === undefined
      ? document.edges.length
      : Math.max(0, Math.min(operation.index, document.edges.length));
    return { ...document, edges: [...document.edges.slice(0, index), operation.edge, ...document.edges.slice(index)] };
  }

  if (operation.kind === "edge.patch") {
    const current = findEdge(document.edges, operation.edgeId);
    const next = { ...current, ...operation.patch, id: current.id };
    validateEdgeEndpoints(document.nodes, next);
    validateCanvasEdgeBudget(next);
    return { ...document, edges: replaceEdge(document.edges, next) };
  }

  if (operation.kind === "edge.delete") {
    findEdge(document.edges, operation.edgeId);
    return { ...document, edges: document.edges.filter((edge) => edge.id !== operation.edgeId) };
  }

  const settings = { ...document.settings, ...operation.patch };
  if (!Number.isInteger(settings.gridSize) || settings.gridSize <= 0) fail("CANVAS_SETTINGS_INVALID", "grid size must be a positive integer");
  return { ...document, settings };
}

export function validateCanvasMutationBatch(operations: readonly CanvasOperation[]): void {
  if (operations.length > CANVAS_MAX_MUTATION_OPERATIONS) {
    throw new CanvasOperationError("MUTATION_OPERATION_LIMIT", `mutation exceeds ${CANVAS_MAX_MUTATION_OPERATIONS} operations`);
  }
  const bytes = serializedByteLength(operations);
  if (bytes > CANVAS_MAX_MUTATION_BYTES) {
    throw new CanvasOperationError("MUTATION_BYTE_LIMIT", `mutation exceeds ${CANVAS_MAX_MUTATION_BYTES} bytes`);
  }
  const seen = new Set<string>();
  for (const operation of operations) {
    if (!operation.opId || seen.has(operation.opId)) fail("MUTATION_OPERATION_ID_INVALID", "operation IDs must be unique and non-empty");
    seen.add(operation.opId);
  }
}

export function applyCanvasOperations(document: CanvasDocumentV2, operations: readonly CanvasOperation[]): CanvasDocumentV2 {
  validateCanvasMutationBatch(operations);
  let next = document;
  for (const operation of operations) next = applyOperation(next, operation);
  try {
    validateCanvasDocumentBudget(next);
  } catch (error) {
    if (error instanceof CanvasLimitError) throw error;
    throw error;
  }
  return next;
}

export function getCanvasOperationTouchedPaths(operation: CanvasOperation): string[] {
  let paths: string[];
  if (operation.kind === "node.create" || operation.kind === "node.delete") {
    paths = [`node:${operation.kind === "node.create" ? operation.node.id : operation.nodeId}.*`];
  } else if (operation.kind === "node.patch") {
    paths = [
      ...(operation.patch.data ? Object.keys(operation.patch.data).map((key) => `node:${operation.nodeId}.data.${key}`) : []),
      ...(operation.patch.unsetDataKeys ?? []).map((key) => `node:${operation.nodeId}.data.${key}`),
      ...(operation.patch.hidden === undefined ? [] : [`node:${operation.nodeId}.hidden`]),
      ...(operation.patch.zIndex === undefined ? [] : [`node:${operation.nodeId}.zIndex`]),
    ];
  } else if (operation.kind === "node.move") {
    paths = [`node:${operation.nodeId}.position`];
  } else if (operation.kind === "node.resize") {
    paths = [`node:${operation.nodeId}.height`, `node:${operation.nodeId}.width`];
  } else if (operation.kind === "node.reparent") {
    paths = [`node:${operation.nodeId}.parentId`];
  } else if (operation.kind === "edge.create" || operation.kind === "edge.delete") {
    paths = [`edge:${operation.kind === "edge.create" ? operation.edge.id : operation.edgeId}.*`];
  } else if (operation.kind === "edge.patch") {
    paths = Object.keys(operation.patch).map((key) => `edge:${operation.edgeId}.${key}`);
  } else {
    paths = Object.keys(operation.patch).map((key) => `canvas.settings.${key}`);
  }
  return [...new Set(paths)].sort();
}
