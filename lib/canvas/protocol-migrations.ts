import { CANVAS_SCHEMA_VERSION, parseCanvasDocumentV2, type CanvasDocumentV2 } from "@/lib/canvas/document";
import {
  CANVAS_OPERATION_PROTOCOL_VERSION,
  validateCanvasMutationBatch,
  type CanvasOperation,
} from "@/lib/canvas/operations";

export class CanvasProtocolVersionError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "CanvasProtocolVersionError";
  }
}

function numericVersion(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function migrateSnapshotV1ToV2(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const snapshot = structuredClone(value as Record<string, unknown>);
  const version = numericVersion(snapshot.schemaVersion);
  if (version === 2) return snapshot;
  if (version !== 1) return snapshot;
  return { ...snapshot, schemaVersion: 2 };
}

export const snapshotMigrators: Readonly<Record<number, (value: unknown) => unknown>> = {
  1: migrateSnapshotV1ToV2,
};

// Operation protocol 1 is the first formal version, so there is no legacy
// operation batch to register yet. Future entries must map N to N + 1 only.
export const operationMigrators: Readonly<Record<number, (operations: unknown[]) => unknown[]>> = {};

export function migrateCanvasSnapshotToCurrent(value: unknown): CanvasDocumentV2 {
  let migrated = structuredClone(value);
  let version = migrated && typeof migrated === "object"
    ? numericVersion((value as Record<string, unknown>).schemaVersion)
    : null;
  if (version !== null && version > CANVAS_SCHEMA_VERSION) {
    throw new CanvasProtocolVersionError(
      "UNSUPPORTED_FUTURE_DOCUMENT_VERSION",
      `document schema ${version} is newer than supported schema ${CANVAS_SCHEMA_VERSION}`,
    );
  }
  while (version !== null && version < CANVAS_SCHEMA_VERSION) {
    const migrator = snapshotMigrators[version];
    if (!migrator) {
      throw new CanvasProtocolVersionError(
        "UNSUPPORTED_LEGACY_DOCUMENT_VERSION",
        `document schema ${String(version)} has no registered migration to ${CANVAS_SCHEMA_VERSION}`,
      );
    }
    migrated = migrator(migrated);
    const nextVersion = migrated && typeof migrated === "object"
      ? numericVersion((migrated as Record<string, unknown>).schemaVersion)
      : null;
    if (nextVersion !== version + 1) {
      throw new CanvasProtocolVersionError(
        "INVALID_DOCUMENT_MIGRATOR_RESULT",
        `document migrator ${version} must produce schema ${version + 1}`,
      );
    }
    version = nextVersion;
  }
  if (version !== CANVAS_SCHEMA_VERSION) {
    throw new CanvasProtocolVersionError(
      "UNSUPPORTED_LEGACY_DOCUMENT_VERSION",
      `document schema ${String(version)} has no registered migration to ${CANVAS_SCHEMA_VERSION}`,
    );
  }
  return parseCanvasDocumentV2(migrated);
}

export function migrateOperationBatchToCurrent(input: {
  protocolVersion: number;
  operations: CanvasOperation[];
}): CanvasOperation[] {
  if (input.protocolVersion > CANVAS_OPERATION_PROTOCOL_VERSION) {
    throw new CanvasProtocolVersionError(
      "UNSUPPORTED_FUTURE_OPERATION_VERSION",
      `operation protocol ${input.protocolVersion} is newer than supported protocol ${CANVAS_OPERATION_PROTOCOL_VERSION}`,
    );
  }
  if (input.protocolVersion !== CANVAS_OPERATION_PROTOCOL_VERSION) {
    throw new CanvasProtocolVersionError(
      "UNSUPPORTED_LEGACY_OPERATION_VERSION",
      `operation protocol ${input.protocolVersion} has no registered migration`,
    );
  }
  validateCanvasMutationBatch(input.operations);
  return input.operations;
}
