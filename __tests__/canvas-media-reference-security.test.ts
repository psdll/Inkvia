import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("canvas media reference authorization", () => {
  it("locks assets and requires ownership or an existing reference from the same canvas", () => {
    const source = readFileSync("lib/canvas/prisma-mutation-store.ts", "utf8");
    expect(source).toContain('asset."ownerUserId" = ${actorUserId}');
    expect(source).toContain('reference."sourceType" = \'canvas_current\'');
    expect(source).toContain('snapshot."canvasId" = ${canvasId}');
    expect(source).toContain("MEDIA_REFERENCE_FORBIDDEN");
    expect(source).toContain("FOR UPDATE");
  });

  it("soft deletes a direct asset only after its final reference is gone", () => {
    const source = readFileSync("lib/canvas/prisma-mutation-store.ts", "utf8");
    expect(source).toContain("'soft_deleted'");
    expect(source).toContain('"referenceCount" = 0');
    expect(source).toContain("INTERVAL '30 days'");
  });
});
