import { describe, expect, it } from "vitest";
import { splitCanvasOperationBatches } from "@/lib/canvas/operation-batching";
import { CANVAS_MAX_MUTATION_BYTES } from "@/lib/canvas/limits";
import { validateCanvasMutationBatch, type CanvasOperation } from "@/lib/canvas/operations";

describe("canvas operation batching", () => {
  it("preserves order while enforcing operation count limits", () => {
    const operations = Array.from({ length: 205 }, (_, index): CanvasOperation => ({
      opId: `op-${index}`,
      kind: "node.move",
      nodeId: `n-${index}`,
      position: { x: index, y: index },
    }));
    const batches = splitCanvasOperationBatches(operations);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 5]);
    expect(batches.flat()).toEqual(operations);
    batches.forEach((batch) => expect(() => validateCanvasMutationBatch(batch)).not.toThrow());
  });

  it("splits on the serialized byte budget and rejects a single oversized operation", () => {
    const operations: CanvasOperation[] = Array.from({ length: 4 }, (_, index) => ({
      opId: `op-${index}`,
      kind: "node.patch",
      nodeId: "a",
      patch: { data: { prompt: "x".repeat(18 * 1024) } },
    }));
    const batches = splitCanvasOperationBatches(operations);
    expect(batches.length).toBeGreaterThan(1);
    batches.forEach((batch) => expect(() => validateCanvasMutationBatch(batch)).not.toThrow());

    expect(() => splitCanvasOperationBatches([{
      opId: "oversized",
      kind: "node.patch",
      nodeId: "a",
      patch: { data: { text: "x".repeat(CANVAS_MAX_MUTATION_BYTES) } },
    }])).toThrowError(expect.objectContaining({ code: "MUTATION_OPERATION_TOO_LARGE" }));
  });
});
