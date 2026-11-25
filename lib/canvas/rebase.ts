import { getCanvasOperationTouchedPaths, type CanvasOperation } from "@/lib/canvas/operations";

export type CanvasRebaseConflict = {
  kind: "manual" | "structural";
  entityId: string;
  path: string;
  localOperation: CanvasOperation;
  remoteOperation: CanvasOperation;
};

export type CanvasDroppedOperation = {
  operation: CanvasOperation;
  reason: "REMOTE_NODE_DELETED" | "REMOTE_EDGE_DELETED";
};

const manualContentSuffixes = [".data.prompt", ".data.system", ".data.text"];

function nodeId(operation: CanvasOperation): string | null {
  if (operation.kind === "node.create") return operation.node.id;
  if (operation.kind.startsWith("node.")) return "nodeId" in operation ? operation.nodeId : null;
  return null;
}

function edgeId(operation: CanvasOperation): string | null {
  if (operation.kind === "edge.create") return operation.edge.id;
  if (operation.kind.startsWith("edge.")) return "edgeId" in operation ? operation.edgeId : null;
  return null;
}

function operationTouchesDeletedEndpoint(operation: CanvasOperation, deletedNodeId: string): boolean {
  if (operation.kind === "edge.create") {
    return operation.edge.source === deletedNodeId || operation.edge.target === deletedNodeId;
  }
  if (operation.kind === "edge.patch") {
    return operation.patch.source === deletedNodeId || operation.patch.target === deletedNodeId;
  }
  return false;
}

function entityIdFor(operation: CanvasOperation): string {
  return nodeId(operation) ?? edgeId(operation) ?? "canvas";
}

export function rebaseCanvasOperations(
  localOperations: readonly CanvasOperation[],
  remoteOperations: readonly CanvasOperation[],
): { operations: CanvasOperation[]; dropped: CanvasDroppedOperation[]; conflicts: CanvasRebaseConflict[] } {
  const operations: CanvasOperation[] = [];
  const dropped: CanvasDroppedOperation[] = [];
  const conflicts: CanvasRebaseConflict[] = [];

  for (const local of localOperations) {
    let rejected = false;
    for (const remote of remoteOperations) {
      if (remote.kind === "node.delete") {
        if (operationTouchesDeletedEndpoint(local, remote.nodeId)) {
          conflicts.push({
            kind: "structural",
            entityId: entityIdFor(local),
            path: `edge:${entityIdFor(local)}`,
            localOperation: local,
            remoteOperation: remote,
          });
          rejected = true;
          break;
        }
        if (nodeId(local) === remote.nodeId && local.kind !== "node.delete") {
          dropped.push({ operation: local, reason: "REMOTE_NODE_DELETED" });
          rejected = true;
          break;
        }
      }

      if (remote.kind === "edge.delete" && edgeId(local) === remote.edgeId && local.kind !== "edge.delete") {
        dropped.push({ operation: local, reason: "REMOTE_EDGE_DELETED" });
        rejected = true;
        break;
      }

      if (local.kind === "node.create" && remote.kind === "node.create" && local.node.id === remote.node.id) {
        conflicts.push({
          kind: "structural",
          entityId: local.node.id,
          path: `node:${local.node.id}`,
          localOperation: local,
          remoteOperation: remote,
        });
        rejected = true;
        break;
      }

      const remotePaths = new Set(getCanvasOperationTouchedPaths(remote));
      const sharedContentPath = getCanvasOperationTouchedPaths(local).find((path) =>
        remotePaths.has(path) && manualContentSuffixes.some((suffix) => path.endsWith(suffix)),
      );
      if (sharedContentPath) {
        conflicts.push({
          kind: "manual",
          entityId: entityIdFor(local),
          path: sharedContentPath,
          localOperation: local,
          remoteOperation: remote,
        });
        rejected = true;
        break;
      }
    }
    if (!rejected) operations.push(local);
  }

  return { operations, dropped, conflicts };
}
