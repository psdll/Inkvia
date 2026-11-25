import {
  CANVAS_MAX_MUTATION_BYTES,
  CANVAS_MUTATION_BATCH_TARGET_BYTES,
  CANVAS_MAX_MUTATION_OPERATIONS,
  serializedByteLength,
} from "@/lib/canvas/limits";
import type { CanvasOperation } from "@/lib/canvas/operations";

export class CanvasOperationBatchingError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CanvasOperationBatchingError";
  }
}

export function splitCanvasOperationBatches(operations: readonly CanvasOperation[]): CanvasOperation[][] {
  const batches: CanvasOperation[][] = [];
  let current: CanvasOperation[] = [];
  for (const operation of operations) {
    if (serializedByteLength([operation]) > CANVAS_MAX_MUTATION_BYTES) {
      throw new CanvasOperationBatchingError(
        "MUTATION_OPERATION_TOO_LARGE",
        `operation ${operation.opId} exceeds the mutation byte budget`,
      );
    }
    const candidate = [...current, operation];
    if (
      candidate.length > CANVAS_MAX_MUTATION_OPERATIONS
      || serializedByteLength(candidate) > CANVAS_MUTATION_BATCH_TARGET_BYTES
    ) {
      if (current.length) batches.push(current);
      current = [operation];
    } else {
      current = candidate;
    }
  }
  if (current.length) batches.push(current);
  return batches;
}
