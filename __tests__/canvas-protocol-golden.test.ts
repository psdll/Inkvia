import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { applyCanvasOperations } from "@/lib/canvas/operations";
import {
  migrateCanvasSnapshotToCurrent,
  migrateOperationBatchToCurrent,
  snapshotMigrators,
} from "@/lib/canvas/protocol-migrations";

function fixture(name: string) {
  return JSON.parse(readFileSync(`__tests__/fixtures/canvas/${name}`, "utf8"));
}

describe("canvas protocol golden fixtures", () => {
  it("migrates snapshots one version at a time without changing business state", () => {
    const expected = fixture("snapshot-v2.json");
    const first = migrateCanvasSnapshotToCurrent(fixture("snapshot-v1.json"));
    const second = migrateCanvasSnapshotToCurrent(fixture("snapshot-v1.json"));

    expect(first).toEqual(expected);
    expect(second).toEqual(first);
    expect(snapshotMigrators[1](first)).toEqual(first);
  });

  it("replays the v1 operation fixture through the latest reducer", () => {
    const snapshot = migrateCanvasSnapshotToCurrent(fixture("snapshot-v1.json"));
    const batch = fixture("operations-v1.json");
    const operations = migrateOperationBatchToCurrent(batch);

    expect(applyCanvasOperations(snapshot, operations).nodes[0].position).toEqual({ x: 30, y: 40 });
  });
});
