import { describe, expect, it, vi } from "vitest";
import {
  CanvasMutationServiceError,
  submitCanvasMutation,
  type CanvasMutationStore,
} from "@/lib/canvas/mutation-service";
import { hashCanvasMutationPayload } from "@/lib/canvas/mutation-contract";

const request = {
  protocolVersion: 1,
  clientMutationId: "123e4567-e89b-42d3-a456-426614174000",
  clientSequence: 3,
  baseRevision: "9",
  operations: [
    { opId: "op-1", kind: "node.move", nodeId: "node-a", position: { x: 5, y: 8 } },
  ],
};

describe("canvas mutation service", () => {
  it("passes a normalized, hashed batch to the atomic store and serializes BigInt revisions", async () => {
    const commit = vi.fn<CanvasMutationStore["commit"]>().mockResolvedValue({ kind: "applied", revision: BigInt(10) });
    const result = await submitCanvasMutation({ canvasId: 12, actorUserId: 7, input: request }, { commit });

    expect(result).toEqual({ success: true, revision: "10", idempotent: false });
    expect(commit).toHaveBeenCalledWith(expect.objectContaining({
      canvasId: 12,
      actorUserId: 7,
      payloadHash: hashCanvasMutationPayload(request),
      touchedPaths: ["node:node-a.position"],
      request: expect.objectContaining({ baseRevision: "9" }),
    }));
  });

  it("returns the original result for an identical duplicate mutation", async () => {
    const commit = vi.fn<CanvasMutationStore["commit"]>().mockResolvedValue({
      kind: "duplicate",
      revision: BigInt(10),
      payloadHash: hashCanvasMutationPayload(request),
    });

    await expect(submitCanvasMutation({ canvasId: 12, actorUserId: 7, input: request }, { commit })).resolves.toEqual({
      success: true,
      revision: "10",
      idempotent: true,
    });
  });

  it("rejects reuse of a mutation ID with a different payload", async () => {
    const store: CanvasMutationStore = {
      commit: vi.fn().mockResolvedValue({ kind: "duplicate", revision: BigInt(10), payloadHash: "different" }),
    };

    await expect(submitCanvasMutation({ canvasId: 12, actorUserId: 7, input: request }, store)).rejects.toEqual(
      expect.objectContaining({ code: "MUTATION_ID_REUSED", status: 409 }),
    );
  });

  it("returns a bounded string-revision conflict payload for client rebase", async () => {
    const store: CanvasMutationStore = {
      commit: vi.fn().mockResolvedValue({
        kind: "conflict",
        currentRevision: BigInt(11),
        hasMore: false,
        missingMutations: [{
          revision: BigInt(10),
          protocolVersion: 1,
          operations: request.operations,
          touchedPaths: ["node:node-a.position"],
        }],
      }),
    };

    await expect(submitCanvasMutation({ canvasId: 12, actorUserId: 7, input: request }, store)).rejects.toEqual(
      expect.objectContaining({
        code: "CANVAS_REVISION_CONFLICT",
        status: 409,
        details: {
          currentRevision: "11",
          hasMore: false,
          missingMutations: [expect.objectContaining({ revision: "10" })],
        },
      }),
    );
  });

  it("uses stable status codes for missing and read-only canvases", async () => {
    await expect(submitCanvasMutation({ canvasId: 12, actorUserId: 7, input: request }, {
      commit: vi.fn().mockResolvedValue({ kind: "not_found" }),
    })).rejects.toEqual(expect.objectContaining({ code: "CANVAS_NOT_FOUND", status: 404 }));

    await expect(submitCanvasMutation({ canvasId: 12, actorUserId: 7, input: request }, {
      commit: vi.fn().mockResolvedValue({ kind: "forbidden" }),
    })).rejects.toEqual(expect.objectContaining({ code: "CANVAS_FORBIDDEN", status: 403 }));
    expect(CanvasMutationServiceError).toBeTypeOf("function");
  });
});
