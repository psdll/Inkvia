import { describe, expect, it } from "vitest";
import { createEmptyCanvasDocumentV2, type CanvasEdge, type CanvasNode } from "@/lib/canvas/document";
import {
  CanvasMutationContractError,
  hashCanvasMutationPayload,
  parseCanvasMutationRequest,
} from "@/lib/canvas/mutation-contract";
import {
  applyCanvasProjectionOperations,
  collectCanvasProjectionRequirements,
} from "@/lib/canvas/projection";

function promptNode(id: string, text = "hello"): CanvasNode {
  return { id, type: "prompt", position: { x: 0, y: 0 }, data: { kind: "prompt", text } };
}

describe("canvas mutation request contract", () => {
  const validRequest = {
    protocolVersion: 1,
    clientMutationId: "123e4567-e89b-42d3-a456-426614174000",
    clientSequence: 7,
    baseRevision: "42",
    operations: [
      { opId: "op-1", kind: "node.move", nodeId: "node-1", position: { x: 10, y: 20 } },
    ],
  };

  it("accepts decimal-string revisions and returns a normalized request", () => {
    expect(parseCanvasMutationRequest(validRequest)).toEqual(validRequest);
  });

  it("rejects numeric revisions, invalid mutation IDs, and unknown operations", () => {
    expect(() => parseCanvasMutationRequest({ ...validRequest, baseRevision: 42 })).toThrowError(
      expect.objectContaining({ code: "MUTATION_REQUEST_INVALID" }),
    );
    expect(() => parseCanvasMutationRequest({ ...validRequest, clientMutationId: "not-a-uuid" })).toThrowError(
      expect.objectContaining({ code: "MUTATION_REQUEST_INVALID" }),
    );
    expect(() => parseCanvasMutationRequest({
      ...validRequest,
      operations: [{ opId: "op-1", kind: "node.teleport", nodeId: "node-1" }],
    })).toThrowError(expect.objectContaining({ code: "MUTATION_REQUEST_INVALID" }));
  });

  it("produces a canonical payload hash independent of object key insertion order", () => {
    const reordered = {
      operations: validRequest.operations.map((operation) => ({
        position: { y: operation.position.y, x: operation.position.x },
        nodeId: operation.nodeId,
        kind: operation.kind,
        opId: operation.opId,
      })),
      baseRevision: validRequest.baseRevision,
      clientSequence: validRequest.clientSequence,
      clientMutationId: validRequest.clientMutationId,
      protocolVersion: validRequest.protocolVersion,
    };

    expect(hashCanvasMutationPayload(validRequest)).toBe(hashCanvasMutationPayload(reordered));
    expect(hashCanvasMutationPayload({ ...validRequest, baseRevision: "43" })).not.toBe(
      hashCanvasMutationPayload(validRequest),
    );
  });

  it("exposes stable typed errors to API callers", () => {
    expect(CanvasMutationContractError).toBeTypeOf("function");
  });
});

describe("canvas current projection", () => {
  it("collects only entities needed for a local projection transaction", () => {
    const requirements = collectCanvasProjectionRequirements([
      { opId: "1", kind: "node.move", nodeId: "a", position: { x: 1, y: 2 } },
      { opId: "2", kind: "node.delete", nodeId: "b" },
      { opId: "3", kind: "edge.patch", edgeId: "e1", patch: { target: "c" } },
      { opId: "4", kind: "edge.create", edge: { id: "e2", source: "a", target: "d" } },
    ]);

    expect(requirements.nodeIds).toEqual(["a", "b", "c", "d"]);
    expect(requirements.edgeIds).toEqual(["e1", "e2"]);
    expect(requirements.incidentEdgeNodeIds).toEqual(["a", "b"]);
    expect(requirements.needsEdgeEndpointHydration).toBe(true);
  });

  it("returns local upserts/deletes and count deltas without a full-canvas replay", () => {
    const nodes = [promptNode("a"), promptNode("b"), promptNode("c")];
    const edges: CanvasEdge[] = [
      { id: "e1", source: "a", target: "b" },
      { id: "e2", source: "b", target: "c" },
    ];
    const operations = [
      { opId: "1", kind: "node.move" as const, nodeId: "a", position: { x: 25, y: 40 } },
      { opId: "2", kind: "node.delete" as const, nodeId: "b" },
      { opId: "3", kind: "node.create" as const, node: promptNode("d") },
      { opId: "4", kind: "edge.create" as const, edge: { id: "e3", source: "a", target: "d" } },
    ];

    const result = applyCanvasProjectionOperations({
      nodes,
      edges,
      settings: createEmptyCanvasDocumentV2().settings,
    }, operations);

    expect(result.nodeUpserts.map((node) => node.id)).toEqual(["a", "d"]);
    expect(result.nodeDeletes).toEqual(["b"]);
    expect(result.edgeUpserts.map((edge) => edge.id)).toEqual(["e3"]);
    expect(result.edgeDeletes).toEqual(["e1", "e2"]);
    expect(result.nodeCountDelta).toBe(0);
    expect(result.edgeCountDelta).toBe(-1);
    expect(result.nodeUpserts[0].position).toEqual({ x: 25, y: 40 });
  });

  it("rejects an edge whose endpoint is absent from the hydrated projection", () => {
    expect(() => applyCanvasProjectionOperations({
      nodes: [promptNode("a")],
      edges: [],
      settings: createEmptyCanvasDocumentV2().settings,
    }, [{
      opId: "1",
      kind: "edge.create",
      edge: { id: "e1", source: "a", target: "missing" },
    }])).toThrowError(expect.objectContaining({ code: "EDGE_TARGET_NOT_FOUND" }));
  });
});
