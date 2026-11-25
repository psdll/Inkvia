import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canvas media reference versus GC locking", () => {
  it("locks ready assets before current and snapshot references are inserted", () => {
    const mutationStore = readFileSync("lib/canvas/prisma-mutation-store.ts", "utf8");
    const snapshotCompactor = readFileSync("lib/canvas/snapshot-compactor.ts", "utf8");

    expect(mutationStore).toMatch(/FROM "MediaAsset"[\s\S]*FOR UPDATE/);
    expect(snapshotCompactor).toMatch(/FROM "MediaAsset"[\s\S]*FOR UPDATE/);
  });
});
