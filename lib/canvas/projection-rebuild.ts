import type { CanvasDocumentV2 } from "@/lib/canvas/document";
import { applyCanvasOperations, type CanvasOperation } from "@/lib/canvas/operations";
import { migrateOperationBatchToCurrent } from "@/lib/canvas/protocol-migrations";

export type CanvasHistoryMutation = {
  revision: string;
  protocolVersion: number;
  operations: CanvasOperation[];
};

export function replayCanvasSnapshotHistory(
  snapshot: CanvasDocumentV2,
  mutations: readonly CanvasHistoryMutation[],
  snapshotRevision?: string,
) {
  let document = snapshot;
  let expected = snapshotRevision === undefined
    ? (mutations.length ? BigInt(mutations[0].revision) - BigInt(1) : BigInt(0))
    : BigInt(snapshotRevision);
  for (const mutation of mutations) {
    const revision = BigInt(mutation.revision);
    if (revision !== expected + BigInt(1)) throw new Error("CANVAS_HISTORY_REVISION_GAP");
    document = applyCanvasOperations(document, migrateOperationBatchToCurrent(mutation));
    expected = revision;
  }
  return document;
}
