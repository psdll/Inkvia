import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string) {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("canvas undo media hold contracts", () => {
  it("defines a unique leased hold for each session media reference", () => {
    const schema = read("prisma/schema.prisma");
    const migration = read(
      "prisma/migrations/20260727190000_canvas_undo_media_holds/migration.sql",
    );

    expect(schema).toContain("model CanvasUndoMediaHold");
    expect(schema).toContain("@@unique([undoSessionId, referenceKey])");
    expect(schema).toContain("@@index([expiresAt])");
    expect(migration).toContain('CREATE TABLE "CanvasUndoMediaHold"');
    expect(migration).toContain(
      '"CanvasUndoMediaHold_undoSessionId_referenceKey_key"',
    );
  });

  it("provides sync, release, and expired-session cleanup services", () => {
    const service = read("lib/canvas/undo-media-holds.ts");

    expect(service).toContain("CANVAS_UNDO_HOLD_MS = 10 * 60 * 1000");
    expect(service).toContain("syncCanvasUndoMediaHolds");
    expect(service).toContain("releaseCanvasUndoMediaHolds");
    expect(service).toContain("cleanupExpiredCanvasUndoMediaHolds");
    expect(service).toContain("deleteStoredMediaRefs");
    expect(service).toContain("hold.mediaId === null ? hold.publicRef : null");
  });

  it("exposes authenticated full-set sync and release endpoints", () => {
    const route = read("app/api/canvas/[id]/undo-media-holds/route.ts");

    expect(route).toContain("export async function PUT");
    expect(route).toContain("export async function DELETE");
    expect(route).toContain("syncCanvasUndoMediaHolds");
    expect(route).toContain("releaseCanvasUndoMediaHolds");
    expect(route).toContain("currentRefs");
    expect(route).toContain('role: { in: ["OWNER", "EDITOR"] }');
  });
});
