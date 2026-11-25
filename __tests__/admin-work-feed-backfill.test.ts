import { describe, expect, it } from "vitest";

describe("admin work feed backfill", () => {
  it("uses resumable cursor and bounded 500-1000 row batches", async () => {
    const module = await import("../scripts/backfill-admin-work-feed.mjs");

    expect(module.parseBackfillOptions(["--cursor", "42", "--batch-size", "750"])).toEqual(
      expect.objectContaining({ cursor: 42, batchSize: 750 }),
    );
    expect(() => module.parseBackfillOptions(["--batch-size", "499"])).toThrow();
    expect(() => module.parseBackfillOptions(["--batch-size", "1001"])).toThrow();
  });

  it("builds the same display priority used by generation works", async () => {
    const { buildWorkFeedProjection } = await import("../scripts/backfill-admin-work-feed.mjs");
    const row = {
      id: 9,
      userId: "device-a",
      authUserId: 7,
      type: "image_edit",
      status: "success",
      source: "canvas",
      externalProvider: null,
      model: "model-a",
      localPath: "/uploads/original.png",
      templateData: JSON.stringify({
        outputDisplayUrl: "/uploads/display.webp",
        outputPreviewUrl: "/uploads/preview.webp",
        outputThumbUrl: "/uploads/thumb.webp",
      }),
      errorMsg: null,
      createdAt: new Date("2026-07-16T00:00:00.000Z"),
      updatedAt: new Date("2026-07-16T00:01:00.000Z"),
      finishedAt: new Date("2026-07-16T00:01:00.000Z"),
      sizeBytes: BigInt("5000000000"),
    };

    expect(buildWorkFeedProjection(row)).toEqual(expect.objectContaining({
      generationId: 9,
      sourceEventId: 0,
      displayUrl: "/uploads/display.webp",
      previewUrl: "/uploads/preview.webp",
      thumbUrl: "/uploads/thumb.webp",
      sizeBytes64: BigInt("5000000000"),
    }));
  });
});
