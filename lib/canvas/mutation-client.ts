import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { createBrowserUuid } from "@/lib/browser/random-uuid";
import { createCanvasDocumentMutation, diffCanvasDocumentsToOperations } from "@/lib/canvas/document-diff";
import type { CanvasDraftCommand, CanvasDraftCommandInput } from "@/lib/canvas/draft-store";
import { splitCanvasOperationBatches } from "@/lib/canvas/operation-batching";
import { CANVAS_OPERATION_PROTOCOL_VERSION, applyCanvasOperations } from "@/lib/canvas/operations";

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type CanvasDraftJournal = {
  pending(): Promise<CanvasDraftCommand[]>;
  flush(sender: (command: CanvasDraftCommand) => Promise<{ revision: string }>): Promise<void>;
  submit(
    input: CanvasDraftCommandInput,
    sender: (command: CanvasDraftCommand) => Promise<{ revision: string }>,
  ): Promise<void>;
};

export class CanvasMutationHttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "CanvasMutationHttpError";
  }
}

async function sendDraftCommand(
  canvasId: number,
  command: CanvasDraftCommand,
  fetcher: FetchLike,
  sessionId: string,
) {
  const response = await fetcher(`/api/canvas/${canvasId}/mutations`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Canvas-Session-Id": sessionId,
    },
    // Full mutation envelopes can exceed the browser's shared 64 KiB keepalive
    // quota even when their operations fit the server budget. The durable
    // journal retains unacknowledged commands if navigation interrupts fetch.
    body: JSON.stringify({
      protocolVersion: command.protocolVersion,
      clientMutationId: command.clientMutationId,
      clientSequence: command.clientSequence,
      baseRevision: command.baseRevision,
      operations: command.operations,
    }),
  });
  const payload = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || payload?.success !== true || typeof payload.revision !== "string") {
    const retryAfterSeconds = Number(response.headers.get("Retry-After"));
    throw new CanvasMutationHttpError(
      typeof payload?.code === "string" ? payload.code : "CANVAS_MUTATION_FAILED",
      typeof payload?.error === "string" ? payload.error : "Canvas mutation failed",
      response.status,
      {
        ...(payload ?? {}),
        clientMutationId: command.clientMutationId,
        ...(Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0
          ? { retryAfterMs: Math.min(retryAfterSeconds * 1_000, 60_000) }
          : {}),
      },
    );
  }
  return { revision: payload.revision };
}

export async function submitCanvasDocumentChange(input: {
  canvasId: number;
  baseRevision: string;
  clientSequence: number;
  before: CanvasDocumentV2;
  after: CanvasDocumentV2;
  journal: CanvasDraftJournal;
  fetcher?: FetchLike;
  sessionId: string;
  mutationId?: () => string;
}): Promise<{ revision: string; clientSequence: number; document: CanvasDocumentV2 }> {
  const fetcher = input.fetcher ?? globalThis.fetch.bind(globalThis);
  const sessionId = input.sessionId.trim();
  if (!sessionId) {
    throw new CanvasMutationHttpError(
      "CANVAS_SESSION_EXPIRED",
      "Canvas editor session expired",
      409,
    );
  }
  const mutationId = input.mutationId ?? createBrowserUuid;
  let revision = input.baseRevision;
  let clientSequence = input.clientSequence;
  let document = input.before;

  if ((await input.journal.pending()).length) {
    await input.journal.flush(async (pending) => {
      const revisionBeforeSend = BigInt(revision);
      const result = await sendDraftCommand(input.canvasId, pending, fetcher, sessionId);
      const acknowledgedRevision = BigInt(result.revision);
      if (BigInt(pending.baseRevision) >= revisionBeforeSend) {
        document = applyCanvasOperations(document, pending.operations);
      }
      if (acknowledgedRevision > revisionBeforeSend) revision = result.revision;
      clientSequence = Math.max(clientSequence, pending.clientSequence + 1);
      return result;
    });
  }

  const allOperations = diffCanvasDocumentsToOperations(document, input.after, `change:${clientSequence}`);
  const batches = splitCanvasOperationBatches(allOperations);

  for (const operations of batches) {
    const id = mutationId();
    const next = applyCanvasOperations(document, operations);
    const inverseOperations = createCanvasDocumentMutation(next, document, id).operations;
    const command: CanvasDraftCommandInput = {
      protocolVersion: CANVAS_OPERATION_PROTOCOL_VERSION,
      clientMutationId: id,
      clientSequence,
      baseRevision: revision,
      operations,
      inverseOperations,
      createdAt: Date.now(),
    };
    let acknowledgedRevision = revision;
    await input.journal.submit(command, async (pending) => {
      const result = await sendDraftCommand(input.canvasId, pending, fetcher, sessionId);
      acknowledgedRevision = result.revision;
      return result;
    });
    revision = acknowledgedRevision;
    clientSequence += 1;
    document = next;
  }
  return { revision, clientSequence, document };
}
