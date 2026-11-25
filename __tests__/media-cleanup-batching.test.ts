import { beforeEach, describe, expect, it, vi } from "vitest";
import path from 'node:path';
import { createHash } from 'node:crypto';
import { resolvePublicPath } from '@/lib/public-path';

const mocks = vi.hoisted(() => ({
  deleteOssObjects: vi.fn(async (keys: string[]) => ({ count: keys.length })),
  generationFindMany: vi.fn<
    () => Promise<Array<{ id: number; localPath: string | null; templateData: string | null }>>
  >(async () => []),
  logFindMany: vi.fn<
    (args: any) => Promise<Array<{ metadata: string | null }>>
  >(async () => []),
  mediaLibraryFindMany: vi.fn(async () => []),
  materialAssetFindMany: vi.fn(async () => []),
  canvasFindMany: vi.fn(async () => []),
  canvasNodeStateFindMany: vi.fn(async () => []),
  mediaAssetFindMany: vi.fn(async () => []),
  queryRaw: vi.fn(async () => []),
  pathExists: vi.fn<(filePath: string) => Promise<boolean>>(async () => false),
  stat: vi.fn(async () => null as any),
  remove: vi.fn<(filePath: string) => Promise<void>>(async () => undefined),
}));

vi.mock("fs-extra", () => ({
  default: {
    pathExists: mocks.pathExists,
    stat: mocks.stat,
    remove: mocks.remove,
  },
}));

vi.mock("@/lib/oss", () => ({
  deleteOssObjects: mocks.deleteOssObjects,
  extractOssObjectKeyFromUrl: (value: unknown) => String(value || "").replace(/^\/+/, ""),
  isOssReady: () => true,
}));

vi.mock("@/lib/prisma", () => ({
  default: {
    generation: { findMany: mocks.generationFindMany },
    log: { findMany: mocks.logFindMany },
    mediaLibraryItem: { findMany: mocks.mediaLibraryFindMany },
    materialAsset: { findMany: mocks.materialAssetFindMany },
    canvas: { findMany: mocks.canvasFindMany },
    canvasNodeState: { findMany: mocks.canvasNodeStateFindMany },
    mediaAsset: { findMany: mocks.mediaAssetFindMany },
    $queryRaw: mocks.queryRaw,
  },
}));

import {
  collectComparableMediaRefsByGenerationWhere,
  computeDeletableRefsForGenerationIds,
  deleteStoredMediaRefs,
} from "@/lib/media-cleanup";

describe("media cleanup batching", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generationFindMany.mockResolvedValue([]);
    mocks.logFindMany.mockResolvedValue([]);
    mocks.mediaLibraryFindMany.mockResolvedValue([]);
    mocks.materialAssetFindMany.mockResolvedValue([]);
    mocks.canvasFindMany.mockResolvedValue([]);
    mocks.canvasNodeStateFindMany.mockResolvedValue([]);
    mocks.mediaAssetFindMany.mockResolvedValue([]);
    mocks.queryRaw.mockResolvedValue([]);
    mocks.pathExists.mockResolvedValue(false);
    mocks.stat.mockResolvedValue(null as any);
    mocks.remove.mockResolvedValue(undefined);
  });

  it("sends all safe OSS keys through one bulk delete call", async () => {
    const result = await deleteStoredMediaRefs([
      "/uploads/generated/a.png",
      "/uploads/generated/b.png",
    ]);

    expect(mocks.deleteOssObjects).toHaveBeenCalledTimes(1);
    expect(mocks.deleteOssObjects).toHaveBeenCalledWith([
      "uploads/generated/a.png",
      "uploads/generated/b.png",
    ]);
    expect(result.deletedOssObjects).toBe(2);
  });

  it("parses serialized media arrays without treating the JSON text as an OSS key", async () => {
    const serializedRefs = JSON.stringify([
      { type: "image", role: "reference_image", url: "/uploads/seedance/a.png" },
      { type: "image", role: "reference_image", url: "/uploads/seedance/b.png" },
    ]);

    await deleteStoredMediaRefs([serializedRefs]);

    expect(mocks.deleteOssObjects).toHaveBeenCalledTimes(1);
    expect(mocks.deleteOssObjects).toHaveBeenCalledWith([
      "uploads/seedance/a.png",
      "uploads/seedance/b.png",
    ]);
  });

  it("keeps batch-import local source paths out of OSS deletion", async () => {
    const result = await deleteStoredMediaRefs([
      "/uploads/batch_imports/2026-08-21/source.png",
    ], {
      protectedGenerationComparableRefs: new Set(),
    });

    expect(mocks.deleteOssObjects).not.toHaveBeenCalled();
    expect(result.ossError).toBe("");
  });

  it("still sends batch-input relay objects through OSS deletion", async () => {
    await deleteStoredMediaRefs([
      "/uploads/batch-input-relay/2026-08-21/source.png",
    ], {
      protectedGenerationComparableRefs: new Set(),
    });

    expect(mocks.deleteOssObjects).toHaveBeenCalledWith([
      "uploads/batch-input-relay/2026-08-21/source.png",
    ]);
  });

  it("reuses an already computed generation protection set without scanning generations again", async () => {
    const result = await deleteStoredMediaRefs(
      ["/uploads/generated/keep.png", "/uploads/generated/delete.png"],
      {
        protectedGenerationComparableRefs: new Set(["/uploads/generated/keep.png"]),
      } as any,
    );

    expect(mocks.generationFindMany).not.toHaveBeenCalled();
    expect(mocks.deleteOssObjects).toHaveBeenCalledWith(["uploads/generated/delete.png"]);
    expect(result.skippedProtectedRefsCount).toBe(1);
  });

  it("keeps a shared product-library file referenced by a historical generation", async () => {
    const productLibraryPath = "/uploads/products/shared/image/keep.png";
    mocks.generationFindMany.mockResolvedValueOnce([
      {
        id: 91,
        localPath: null,
        templateData: JSON.stringify({ imagePaths: [productLibraryPath] }),
      },
    ]);

    const result = await deleteStoredMediaRefs([productLibraryPath], {
      allowMaterialDeletion: true,
      excludeMediaLibraryItemIds: [12],
    });

    expect(mocks.deleteOssObjects).not.toHaveBeenCalled();
    expect(result.skippedProtectedRefsCount).toBe(1);
    expect(result.skippedProtectedRefsPreview).toEqual([productLibraryPath]);
  });

  it("fails closed when a protected-reference index cannot be loaded", async () => {
    mocks.mediaLibraryFindMany.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(deleteStoredMediaRefs(["/uploads/generated/delete.png"]))
      .rejects.toThrow("database unavailable");
    expect(mocks.deleteOssObjects).not.toHaveBeenCalled();
  });

  it("chunks generation log lookups below the Prisma parameter limit", async () => {
    mocks.generationFindMany.mockResolvedValue(
      Array.from({ length: 25_001 }, (_, index) => ({
        id: index + 1,
        localPath: null,
        templateData: null,
      })),
    );
    mocks.logFindMany.mockImplementation(async ({ where }: any) => {
      const ids = where?.generationId?.in || [];
      if (ids.length > 10_000) {
        throw new Error("Query parameter limit exceeded");
      }
      return [];
    });

    await expect(
      collectComparableMediaRefsByGenerationWhere({}),
    ).resolves.toEqual(new Set());
    expect(mocks.logFindMany).toHaveBeenCalledTimes(3);
    for (const [args] of mocks.logFindMany.mock.calls) {
      expect(args.where.generationId.in.length).toBeLessThanOrEqual(10_000);
    }
  });

  it("uses candidate MediaAsset relations instead of full library and canvas scans for canonical outputs", async () => {
    await deleteStoredMediaRefs(["/uploads/generated/delete.png"], {
      canonicalGenerationOutputs: true,
      canonicalGenerationMediaIds: ["media-output"],
      protectedGenerationComparableRefs: new Set(),
    } as any);

    expect(mocks.mediaAssetFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: { in: ["media-output"] },
      }),
    }));
    expect(mocks.mediaLibraryFindMany).not.toHaveBeenCalled();
    expect(mocks.materialAssetFindMany).not.toHaveBeenCalled();
    expect(mocks.canvasNodeStateFindMany).not.toHaveBeenCalled();
  });

  it("checks canonical localPath candidates through the bounded indexed query", async () => {
    mocks.generationFindMany
      .mockResolvedValueOnce([{ id: 11, localPath: "/uploads/generated/delete.png", templateData: null }])
      .mockResolvedValueOnce([]);

    await expect(computeDeletableRefsForGenerationIds([11])).resolves.toEqual([
      "/uploads/generated/delete.png",
    ]);

    expect(mocks.generationFindMany).toHaveBeenCalledTimes(2);
    expect(mocks.generationFindMany).toHaveBeenLastCalledWith({
      where: {
        id: { notIn: [11] },
        localPath: { in: ["/uploads/generated/delete.png"] },
      },
      select: { localPath: true },
    });
    expect(mocks.logFindMany).not.toHaveBeenCalled();
  });

  it("extracts paths from legacy JSON fragments without deleting the fragment as an object key", async () => {
    const fragment = '/uploads/generated/a.png"],"outputThumbUrl":"/uploads/generated/b.webp","prompt":"' + 'x'.repeat(1200);

    await deleteStoredMediaRefs([fragment]);

    expect(mocks.deleteOssObjects).toHaveBeenCalledWith([
      "uploads/generated/a.png",
      "uploads/generated/b.webp",
    ]);
    expect(mocks.pathExists.mock.calls.every(([file]) => !file.includes('"'))).toBe(true);
  });

  it("preserves shared media extracted from a legacy JSON fragment", async () => {
    mocks.generationFindMany.mockResolvedValue([
      { id: 91, localPath: "/uploads/generated/shared.png", templateData: null },
    ]);

    const result = await deleteStoredMediaRefs([
      '/uploads/generated/shared.png"],"providerStatus":"success"}',
    ]);

    expect(mocks.deleteOssObjects).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(result.skippedProtectedRefsPreview).toContain("/uploads/generated/shared.png");
  });

  it("protects an audio file still owned by another generation", async () => {
    const localPath = "/uploads/canvas_audio_results/shared.mp3";
    mocks.generationFindMany.mockResolvedValueOnce([{ id: 71, localPath, templateData: null }])
      .mockResolvedValueOnce([{ id: 72, localPath, templateData: null }]);
    await expect(computeDeletableRefsForGenerationIds([71])).resolves.toEqual([]);
    expect(mocks.deleteOssObjects).not.toHaveBeenCalled();
  });

  it("deletes an unreferenced audio output through canonical storage cleanup", async () => {
    const result = await deleteStoredMediaRefs(["/uploads/canvas_audio_results/delete.mp3"], {
      canonicalGenerationOutputs: true, canonicalGenerationMediaIds: ["audio-media"],
      protectedGenerationComparableRefs: new Set(),
    } as any);
    expect(result.deletedOssObjects).toBe(1);
    expect(mocks.deleteOssObjects).toHaveBeenCalledWith(["uploads/canvas_audio_results/delete.mp3"]);
  });

  it("includes owned generated thumbnails and previews without treating input media as owned output", async () => {
    mocks.generationFindMany
      .mockResolvedValueOnce([{
        id: 21,
        localPath: "/uploads/generated/original.png",
        templateData: JSON.stringify({
          outputThumbUrl: "/uploads/generation_previews/thumb.webp",
          outputPreviewUrl: "/uploads/generation_previews/preview.webp",
          outputPosterUrl: "/uploads/generation_posters/poster.webp",
          imagePaths: ["/uploads/imports/input.png"],
        }),
      }])
      .mockResolvedValueOnce([]);

    await expect(computeDeletableRefsForGenerationIds([21])).resolves.toEqual([
      "/uploads/generated/original.png",
      "/uploads/generation_previews/thumb.webp",
      "/uploads/generation_previews/preview.webp",
      "/uploads/generation_posters/poster.webp",
    ]);
  });

  it("deletes the source file together with its standard local thumbnail cache variants", async () => {
    mocks.pathExists.mockResolvedValue(true);
    mocks.stat.mockResolvedValue({ isFile: () => true, mtimeMs: 1234, size: 2048 } as any);

    await deleteStoredMediaRefs(["/uploads/generated/delete.png"], {
      localOnly: true,
      protectedGenerationComparableRefs: new Set(),
    });

    const uploads = path.resolve(process.env.UPLOADS_DIR || resolvePublicPath("uploads"));
    const source = path.join(uploads, 'generated', 'delete.png');
    // Independent cache-key oracle and explicit supported widths, not the function under test.
    const expected = [source, ...[100, 120, 200, 300, 400, 600, 800, 1200, 1600].map(width =>
      path.join(uploads, '_thumbs', `${createHash('sha1').update(source).update('1234').update(`w${width}`).update('q88').digest('hex')}.webp`))];
    expect(mocks.remove.mock.calls.map(([filePath]) => String(filePath)).sort()).toEqual(expected.sort());
  });
});
