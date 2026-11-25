import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { CANVAS_SCHEMA_VERSION, type CanvasDocumentV2 } from "@/lib/canvas/document";
import { serializedByteLength, validateCanvasDocumentBudget } from "@/lib/canvas/limits";
import { CANVAS_OPERATION_PROTOCOL_VERSION } from "@/lib/canvas/operations";
import { migrateCanvasSnapshotToCurrent } from "@/lib/canvas/protocol-migrations";

export type EncodedCanvasSnapshot = {
  revision: string;
  documentSchemaVersion: number;
  operationProtocolVersion: number;
  codec: "gzip";
  compressedJson: Uint8Array;
  uncompressedBytes: number;
  checksumSha256: string;
  nodeCount: number;
  edgeCount: number;
};

export class CanvasSnapshotCodecError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CanvasSnapshotCodecError";
  }
}

function checksum(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildCanvasSnapshot(document: CanvasDocumentV2, revision: string): EncodedCanvasSnapshot {
  if (!/^(0|[1-9]\d*)$/.test(revision)) {
    throw new CanvasSnapshotCodecError("SNAPSHOT_REVISION_INVALID", "Snapshot revision must be a decimal string");
  }
  validateCanvasDocumentBudget(document);
  const serialized = Buffer.from(JSON.stringify(document), "utf8");
  return {
    revision,
    documentSchemaVersion: CANVAS_SCHEMA_VERSION,
    operationProtocolVersion: CANVAS_OPERATION_PROTOCOL_VERSION,
    codec: "gzip",
    compressedJson: gzipSync(serialized, { level: 6 }),
    uncompressedBytes: serializedByteLength(document),
    checksumSha256: checksum(serialized),
    nodeCount: document.nodes.length,
    edgeCount: document.edges.length,
  };
}

export function decodeCanvasSnapshot(snapshot: EncodedCanvasSnapshot): CanvasDocumentV2 {
  let bytes: Buffer;
  try {
    bytes = gunzipSync(snapshot.compressedJson);
  } catch {
    throw new CanvasSnapshotCodecError("SNAPSHOT_DECOMPRESSION_FAILED", "Snapshot gzip payload is corrupt");
  }
  if (bytes.byteLength !== snapshot.uncompressedBytes) {
    throw new CanvasSnapshotCodecError("SNAPSHOT_SIZE_MISMATCH", "Snapshot byte length does not match metadata");
  }
  if (checksum(bytes) !== snapshot.checksumSha256) {
    throw new CanvasSnapshotCodecError("SNAPSHOT_CHECKSUM_MISMATCH", "Snapshot checksum verification failed");
  }
  let value: unknown;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new CanvasSnapshotCodecError("SNAPSHOT_JSON_INVALID", "Snapshot JSON is invalid");
  }
  return migrateCanvasSnapshotToCurrent(value);
}
