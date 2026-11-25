import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import sharp from "sharp";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { backfillMaterialThumbnails, parseMaterialThumbnailOptions } from "@/scripts/backfill-material-thumbnails";
import { getThumbnailCacheKey } from "@/lib/thumbnail-cache";

let root: string;
const originalFileCacheLimit = sharp.cache().files.max;
// libvips otherwise retains file handles after conversion on Windows.
beforeAll(() => { sharp.cache({ files: 0 }); });
afterAll(() => { sharp.cache({ files: originalFileCacheLimit }); });
beforeEach(async () => { root = await mkdtemp(path.join(os.tmpdir(), "material-preview-test-")); });
afterEach(async () => {
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("material-preview-test-")) throw new Error("unsafe test cleanup");
  await rm(root, { recursive: true, force: true });
});
const row = (id: number, imageUrl: string, extra = {}) => ({ id, imageUrl, thumbnailUrl: null, previewUrl: null, mimeType: "image/png", media: [], ...extra });
const database = (rows: ReturnType<typeof row>[]) => ({ materialAsset: { findMany: vi.fn(async (query: any) => rows.filter(r => r.id > query.where.id.gt).slice(0, query.take)) } });
const options = { apply: false, after: 0, limit: 200 };

it("prepares exactly the live thumbnail cache key, leaves originals alone, and is idempotent", async () => {
  const original = await sharp({ create: { width: 1600, height: 2000, channels: 3, background: "#123456" } }).png().toBuffer();
  const sourcePath = path.join(root, "original.png");
  await writeFile(sourcePath, original);
  const before = await stat(sourcePath);
  const prisma = database([row(1, "/uploads/original.png")]);
  const dependencies = { prisma: prisma as any, uploadsRoot: root };
  expect(await backfillMaterialThumbnails(options, dependencies)).toMatchObject({ missing: 1, generated: 0 });
  expect(await readdir(root)).toEqual(["original.png"]);
  expect(await backfillMaterialThumbnails({ ...options, apply: true }, dependencies)).toMatchObject({ missing: 1, generated: 1, failed: 0 });
  const cached = path.join(root, "_thumbs", `${getThumbnailCacheKey({ sourcePath, sourceMtimeMs: before.mtimeMs, width: 1200 })}.webp`);
  expect(await sharp(cached).metadata()).toMatchObject({ width: 1200, height: 1500, format: "webp" });
  expect(await readFile(sourcePath)).toEqual(original);
  expect((await stat(sourcePath)).mtimeMs).toBe(before.mtimeMs);
  const cachedStat = await stat(cached);
  expect(await backfillMaterialThumbnails({ ...options, apply: true }, dependencies)).toMatchObject({ hits: 1, generated: 0 });
  expect((await stat(cached)).mtimeMs).toBe(cachedStat.mtimeMs);
});

it("skips remote/private sources, reports missing files and continues after a corrupt image", async () => {
  await writeFile(path.join(root, "bad.png"), "not an image");
  await sharp({ create: { width: 80, height: 100, channels: 3, background: "#123456" } }).png().toFile(path.join(root, "good.png"));
  const prisma = database([row(1, "https://example.com/remote.png"), row(2, "/uploads/../private.png"), row(3, "/uploads/canvas-library/1/private.png"), row(4, "/uploads/missing.png"), row(5, "/uploads/bad.png"), row(6, "/uploads/good.png")]);
  expect(await backfillMaterialThumbnails({ ...options, apply: true }, { prisma: prisma as any, uploadsRoot: root }))
    .toMatchObject({ scanned: 6, skipped: 3, missingSource: 1, failed: 1, generated: 1, nextAfter: 6 });
});

it("only scans the requested resumable batch and recognizes prepared small originals", async () => {
  await writeFile(path.join(root, "small-card-1200.webp"), "existing prepared preview");
  const prisma = database([row(1, "/uploads/old.png"), row(2, "/uploads/small.png", { thumbnailUrl: "/uploads/small-card-1200.webp", media: [{ width: 800 }] }), row(3, "/uploads/next.png")]);
  expect(await backfillMaterialThumbnails({ ...options, after: 1, limit: 1 }, { prisma: prisma as any, uploadsRoot: root }))
    .toMatchObject({ scanned: 1, prepared: 1, nextAfter: 2 });
  expect(prisma.materialAsset.findMany.mock.calls[0][0].where.isDeleted).toBe(false);
});

it("uses video posters without extracting or downloading the full video", async () => {
  await sharp({ create: { width: 80, height: 100, channels: 3, background: "#123456" } }).webp().toFile(path.join(root, "poster.webp"));
  const prisma = database([row(1, "/uploads/video.mp4", { mimeType: "video/mp4", thumbnailUrl: "/uploads/poster.webp" }), row(2, "/uploads/no-poster.mp4", { mimeType: "video/mp4" })]);
  expect(await backfillMaterialThumbnails({ ...options, apply: true }, { prisma: prisma as any, uploadsRoot: root }))
    .toMatchObject({ scanned: 2, generated: 1, skipped: 1, failed: 0 });
});

it("defaults to a dry run and validates bounded batch options", () => {
  expect(parseMaterialThumbnailOptions([])).toEqual(options);
  expect(parseMaterialThumbnailOptions(["--apply", "--after=15", "--limit=50"])).toEqual({ apply: true, after: 15, limit: 50 });
  for (const args of [["--limit=0"], ["--limit=10001"], ["--after=-1"], ["--force"]]) expect(() => parseMaterialThumbnailOptions(args)).toThrow();
});
