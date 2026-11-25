import fs from "fs-extra";
import path from "node:path";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { collectMediaRefs, normalizeComparableMediaRef } from "@/lib/media-cleanup";

const MANAGED_DERIVED_DIRECTORIES = [
  "generation_previews",
  "generation_posters",
  "products/thumbs/generated",
  "products/previews/generated",
  "products/posters/generated",
  "material_library/thumbs",
  "material_library/previews",
  "material_library/posters",
  "materials/thumbs",
  "inspiration_assets/previews",
  "inspiration_assets/posters",
] as const;

function addComparableRefs(value: unknown, refs: Set<string>) {
  const rawRefs = new Set<string>();
  collectMediaRefs(value, rawRefs);
  for (const ref of rawRefs) {
    const comparable = normalizeComparableMediaRef(ref);
    if (comparable) refs.add(comparable);
  }
}

async function collectGenerationRefs(refs: Set<string>) {
  const batchSize = 1000;
  let cursor = 0;
  while (true) {
    const rows = await prisma.generation.findMany({
      where: {
        status: { not: "deleted" },
        ...(cursor > 0 ? { id: { gt: cursor } } : {}),
      },
      orderBy: { id: "asc" },
      take: batchSize,
      select: { id: true, localPath: true, templateData: true },
    });
    if (!rows.length) break;
    for (const row of rows) {
      addComparableRefs(row.localPath, refs);
      addComparableRefs(row.templateData, refs);
    }
    cursor = rows[rows.length - 1].id;
  }
}

async function collectProtectedThumbnailAssetRefs() {
  const refs = new Set<string>();
  await collectGenerationRefs(refs);
  const [adminAssets, adminWorks, mediaItems, materialAssets, canvases, canvasNodes, canvasUndoHolds, templates, settings] = await Promise.all([
    prisma.adminAssetFeed.findMany({
      where: { deletedAt: null },
      select: { thumbUrl: true, displayUrl: true, previewUrl: true, posterUrl: true },
    }),
    prisma.adminWorkFeed.findMany({
      where: { deletedAt: null },
      select: { thumbUrl: true, displayUrl: true, previewUrl: true, posterUrl: true },
    }),
    prisma.mediaLibraryItem.findMany({
      where: { isDeleted: false },
      select: { fileUrl: true, thumbnailUrl: true },
    }),
    prisma.materialAsset.findMany({
      where: { isDeleted: false },
      select: { imageUrl: true, thumbnailUrl: true, previewUrl: true, media: true },
    }),
    prisma.canvas.findMany({
      where: { deletedAt: null },
      select: { data: true, thumbnail: true },
    }),
    prisma.canvasNodeState.findMany({ select: { data: true } }),
    prisma.$queryRaw<Array<{ publicRef: string | null }>>(Prisma.sql`
      SELECT "publicRef"
      FROM "CanvasUndoMediaHold"
      WHERE "expiresAt" > CURRENT_TIMESTAMP
        AND "publicRef" IS NOT NULL
    `),
    prisma.template.findMany({ select: { previewImagePath: true, previewVideoPath: true } }),
    prisma.appSetting.findMany({ select: { value: true } }),
  ]);

  for (const row of [...adminAssets, ...adminWorks]) {
    addComparableRefs(row.thumbUrl, refs);
    addComparableRefs(row.displayUrl, refs);
    addComparableRefs(row.previewUrl, refs);
    addComparableRefs(row.posterUrl, refs);
  }
  for (const row of mediaItems) {
    addComparableRefs(row.fileUrl, refs);
    addComparableRefs(row.thumbnailUrl, refs);
  }
  for (const row of materialAssets) {
    addComparableRefs(row.imageUrl, refs);
    addComparableRefs(row.thumbnailUrl, refs);
    addComparableRefs(row.previewUrl, refs);
    addComparableRefs(row.media, refs);
  }
  for (const row of canvases) {
    addComparableRefs(row.data, refs);
    addComparableRefs(row.thumbnail, refs);
  }
  for (const row of canvasNodes) addComparableRefs(row.data, refs);
  for (const row of canvasUndoHolds) addComparableRefs(row.publicRef, refs);
  for (const row of templates) {
    addComparableRefs(row.previewImagePath, refs);
    addComparableRefs(row.previewVideoPath, refs);
  }
  for (const row of settings) addComparableRefs(row.value, refs);
  return refs;
}

function publicUploadRef(uploadsRoot: string, diskPath: string) {
  const relative = path.relative(uploadsRoot, diskPath);
  if (!relative || relative === "." || relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return `/uploads/${relative.replaceAll(path.sep, "/")}`;
}

async function listFiles(rootDir: string) {
  if (!(await fs.pathExists(rootDir).catch(() => false))) return [] as string[];
  const files: string[] = [];
  const stack = [rootDir];
  while (stack.length) {
    const current = stack.pop() as string;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(fullPath);
      else if (entry.isFile()) files.push(fullPath);
    }
  }
  return files;
}

export async function cleanupStoredThumbnailAssets(options: {
  uploadsRoot: string;
  olderThanDays: number;
  now?: Date;
  protectedRefs?: Set<string>;
}) {
  const uploadsRoot = path.resolve(options.uploadsRoot);
  const days = Math.max(1, Math.floor(Number(options.olderThanDays) || 1));
  const cutoffMs = (options.now || new Date()).getTime() - days * 24 * 60 * 60 * 1000;
  const protectedRefs = options.protectedRefs || await collectProtectedThumbnailAssetRefs();
  const candidates: Array<{ path: string; size: number; cache: boolean }> = [];
  let scannedFiles = 0;

  for (const relativeDir of ["_thumbs", ...MANAGED_DERIVED_DIRECTORIES]) {
    const cache = relativeDir === "_thumbs";
    const files = await listFiles(path.join(uploadsRoot, ...relativeDir.split("/")));
    for (const filePath of files) {
      scannedFiles += 1;
      const fileStat = await fs.stat(filePath).catch(() => null);
      if (!fileStat?.isFile() || fileStat.mtimeMs >= cutoffMs) continue;
      const publicRef = publicUploadRef(uploadsRoot, filePath);
      if (!cache && (!publicRef || protectedRefs.has(publicRef))) continue;
      candidates.push({ path: filePath, size: Number(fileStat.size || 0), cache });
    }
  }

  let deletedCacheFiles = 0;
  let deletedOrphanFiles = 0;
  let deletedBytes = 0;
  let failedFiles = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const candidate = candidates[cursor++];
      const removed = await fs.remove(candidate.path).then(() => true).catch(() => false);
      if (!removed) {
        failedFiles += 1;
        continue;
      }
      deletedBytes += candidate.size;
      if (candidate.cache) deletedCacheFiles += 1;
      else deletedOrphanFiles += 1;
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, candidates.length) }, () => worker()));

  return {
    days,
    cutoff: new Date(cutoffMs).toISOString(),
    scannedFiles,
    protectedFiles: protectedRefs.size,
    deletedCacheFiles,
    deletedOrphanFiles,
    deletedBytes,
    failedFiles,
  };
}
