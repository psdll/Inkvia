import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  assertCanvasMediaTransition,
  canvasMediaRetentionDeadline,
  isCanvasMediaGarbageCollectable,
} from "@/lib/canvas/media-lifecycle";
import { collectCanvasCurrentMediaReferenceChanges, collectCanvasNodeMediaIds } from "@/lib/canvas/media-references";

describe("canvas media lifecycle", () => {
  it("accepts only declared forward and retry transitions", () => {
    expect(() => assertCanvasMediaTransition("initiated", "ready")).not.toThrow();
    expect(() => assertCanvasMediaTransition("purging", "purged")).not.toThrow();
    expect(() => assertCanvasMediaTransition("ready", "failed")).toThrow(/MEDIA_INVALID_TRANSITION/);
    expect(() => assertCanvasMediaTransition("purged", "ready")).toThrow(/MEDIA_INVALID_TRANSITION/);
  });

  it("keeps referenced and retained assets out of garbage collection", () => {
    const now = new Date("2026-07-20T00:00:00.000Z");
    expect(isCanvasMediaGarbageCollectable({ status: "soft_deleted", referenceCount: 1, retentionUntil: new Date("2026-07-01") }, now)).toBe(false);
    expect(isCanvasMediaGarbageCollectable({ status: "soft_deleted", referenceCount: 0, retentionUntil: new Date("2026-08-01") }, now)).toBe(false);
    expect(isCanvasMediaGarbageCollectable({ status: "soft_deleted", referenceCount: 0, retentionUntil: new Date("2026-07-01") }, now)).toBe(true);
    expect(isCanvasMediaGarbageCollectable({ status: "ready", referenceCount: 0, retentionUntil: new Date("2026-07-01") }, now)).toBe(false);
  });

  it("uses the frozen retention windows", () => {
    const createdAt = new Date("2026-07-20T00:00:00.000Z");
    expect(canvasMediaRetentionDeadline("initiated", createdAt).toISOString()).toBe("2026-07-21T00:00:00.000Z");
    expect(canvasMediaRetentionDeadline("failed", createdAt).toISOString()).toBe("2026-07-27T00:00:00.000Z");
    expect(canvasMediaRetentionDeadline("soft_deleted", createdAt).toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("collects explicit media ids without treating legacy urls as assets", () => {
    expect(collectCanvasNodeMediaIds({
      id: "video-1",
      type: "video",
      position: { x: 0, y: 0 },
      data: {
        kind: "video",
        mediaId: "d31782e3-d0fb-4aa1-9096-a7d16878cd55",
        url: "/uploads/legacy.mp4",
        variants: {
          poster: { mediaId: "eb7ca305-1f83-44d0-81c7-66f3ee6bf751", url: "/poster.jpg" },
        },
      },
    })).toEqual([
      "d31782e3-d0fb-4aa1-9096-a7d16878cd55",
      "eb7ca305-1f83-44d0-81c7-66f3ee6bf751",
    ]);
  });

  it("creates canvas-scoped replacement sets for changed and deleted nodes", () => {
    expect(collectCanvasCurrentMediaReferenceChanges(42, [{
      id: "image-1",
      type: "image",
      position: { x: 0, y: 0 },
      data: { kind: "image", mediaId: "d31782e3-d0fb-4aa1-9096-a7d16878cd55", url: "/image.jpg" },
    }], ["deleted-1"])).toEqual([
      {
        sourceId: "canvas:42:node:deleted-1",
        mediaIds: [],
      },
      {
        sourceId: "canvas:42:node:image-1",
        mediaIds: ["d31782e3-d0fb-4aa1-9096-a7d16878cd55"],
      },
    ]);
  });

  it("keeps active canvas undo holds out of physical deletion and media GC", () => {
    const cleanup = readFileSync("lib/media-cleanup.ts", "utf8");
    const mediaGc = readFileSync("lib/canvas/media-gc.ts", "utf8");
    const maintenance = readFileSync("app/api/internal/canvas-maintenance/route.ts", "utf8");

    expect(cleanup).toContain('FROM "CanvasUndoMediaHold"');
    expect(cleanup).toContain('"expiresAt" > CURRENT_TIMESTAMP');
    expect(mediaGc).toContain('FROM "CanvasUndoMediaHold"');
    expect(mediaGc).toContain('hold."expiresAt" >');
    expect(maintenance).toContain("cleanupExpiredCanvasUndoMediaHolds");
  });
});
