import crypto from "node:crypto";
import type { CanvasDocumentV2, CanvasNode, CanvasNodeKind } from "@/lib/canvas/document";

export type CanvasRunScope = "single" | "downstream" | "full";

export type PlannedCanvasRunStep = {
  stepKey: string;
  nodeId: string;
  nodeKind: CanvasNodeKind;
  requestKey: string;
  dependencies: string[];
  provider?: string;
  input: {
    node: CanvasNode;
    incomingNodes: CanvasNode[];
    incomingEdges: CanvasDocumentV2["edges"];
  };
};

const EXECUTABLE_KINDS = new Set<CanvasNodeKind>(["imageTask", "videoTask", "audioTask", "llm", "loop"]);

export function deriveCanvasStepRequestKey(runRequestKey: string, stepKey: string): string {
  const digest = crypto.createHash("sha256").update(`${runRequestKey}:${stepKey}`, "utf8").digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
function selectedNodeIds(document: CanvasDocumentV2, scope: CanvasRunScope, requestedIds: readonly string[]) {
  if (scope === "full") return new Set(document.nodes.map((node) => node.id));
  const selected = new Set(requestedIds);
  if (scope === "single") return selected;
  const outgoing = new Map<string, string[]>();
  for (const edge of document.edges) outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge.target]);
  const queue = [...selected];
  for (let index = 0; index < queue.length; index += 1) {
    for (const target of outgoing.get(queue[index]) ?? []) {
      if (selected.has(target)) continue;
      selected.add(target);
      queue.push(target);
    }
  }
  return selected;
}

export function planCanvasRunSteps(
  document: CanvasDocumentV2,
  input: { scope: CanvasRunScope; nodeIds: readonly string[]; runRequestKey: string },
): PlannedCanvasRunStep[] {
  const selected = selectedNodeIds(document, input.scope, input.nodeIds);
  const executableIds = new Set(document.nodes
    .filter((node) => selected.has(node.id) && EXECUTABLE_KINDS.has(node.data.kind))
    .map((node) => node.id));
  return document.nodes.flatMap((node): PlannedCanvasRunStep[] => {
    if (!executableIds.has(node.id)) return [];
    const incomingEdges = document.edges.filter((edge) => edge.target === node.id);
    const incomingNodeIds = new Set(incomingEdges.map((edge) => edge.source));
    const incomingNodes = document.nodes.filter((candidate) => incomingNodeIds.has(candidate.id));
    const dependencies = incomingNodes.filter((candidate) => executableIds.has(candidate.id)).map((candidate) => candidate.id);
    const data = node.data as unknown as Record<string, unknown>;
    return [{
      stepKey: node.id,
      nodeId: node.id,
      nodeKind: node.data.kind,
      requestKey: deriveCanvasStepRequestKey(input.runRequestKey, node.id),
      dependencies,
      provider: typeof data.providerId === "string" ? data.providerId : undefined,
      input: { node, incomingNodes, incomingEdges },
    }];
  });
}
