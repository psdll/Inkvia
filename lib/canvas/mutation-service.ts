import {
  hashCanvasMutationPayload,
  parseCanvasMutationRequest,
  type CanvasMutationRequest,
} from "@/lib/canvas/mutation-contract";
import { getCanvasOperationTouchedPaths, type CanvasOperation } from "@/lib/canvas/operations";

export type StoredCanvasMutation = {
  revision: bigint;
  protocolVersion: number;
  operations: CanvasOperation[];
  touchedPaths: string[];
};

export type CanvasMutationCommitInput = {
  canvasId: number;
  actorUserId: number;
  payloadHash: string;
  touchedPaths: string[];
  request: CanvasMutationRequest;
};

export type CanvasMutationCommitOutcome =
  | { kind: "applied"; revision: bigint }
  | { kind: "duplicate"; revision: bigint; payloadHash: string }
  | {
      kind: "conflict";
      currentRevision: bigint;
      missingMutations: StoredCanvasMutation[];
      hasMore: boolean;
    }
  | { kind: "not_found" }
  | { kind: "forbidden" };

export type CanvasMutationStore = {
  commit(input: CanvasMutationCommitInput): Promise<CanvasMutationCommitOutcome>;
};

export class CanvasMutationServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CanvasMutationServiceError";
  }
}

export type SubmitCanvasMutationInput = {
  canvasId: number;
  actorUserId: number;
  input: unknown;
};

export type SubmitCanvasMutationResult = {
  success: true;
  revision: string;
  idempotent: boolean;
};

export async function submitCanvasMutation(
  input: SubmitCanvasMutationInput,
  store: CanvasMutationStore,
): Promise<SubmitCanvasMutationResult> {
  const request = parseCanvasMutationRequest(input.input);
  const payloadHash = hashCanvasMutationPayload(request);
  const touchedPaths = [...new Set(request.operations.flatMap(getCanvasOperationTouchedPaths))].sort();
  const outcome = await store.commit({
    canvasId: input.canvasId,
    actorUserId: input.actorUserId,
    payloadHash,
    touchedPaths,
    request,
  });

  if (outcome.kind === "applied") {
    return { success: true, revision: outcome.revision.toString(), idempotent: false };
  }
  if (outcome.kind === "duplicate") {
    if (outcome.payloadHash !== payloadHash) {
      throw new CanvasMutationServiceError(
        "MUTATION_ID_REUSED",
        "The client mutation ID was already used for a different payload",
        409,
      );
    }
    return { success: true, revision: outcome.revision.toString(), idempotent: true };
  }
  if (outcome.kind === "conflict") {
    throw new CanvasMutationServiceError(
      "CANVAS_REVISION_CONFLICT",
      "The canvas revision changed; rebase the pending operations",
      409,
      {
        currentRevision: outcome.currentRevision.toString(),
        hasMore: outcome.hasMore,
        missingMutations: outcome.missingMutations.map((mutation) => ({
          ...mutation,
          revision: mutation.revision.toString(),
        })),
      },
    );
  }
  if (outcome.kind === "forbidden") {
    throw new CanvasMutationServiceError("CANVAS_FORBIDDEN", "Canvas is read-only for this user", 403);
  }
  throw new CanvasMutationServiceError("CANVAS_NOT_FOUND", "Canvas not found", 404);
}
