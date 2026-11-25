import fs from "fs-extra";
import path from "path";
import prisma from "@/lib/prisma";
import { collectMediaRefs, normalizeComparableMediaRef } from "@/lib/media-cleanup";
import { resolvePublicPath } from "@/lib/public-path";

export const IMPORT_ORPHAN_COOLDOWN_HOURS = 24;

const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif", ".bmp", ".tif", ".tiff"]);
const VIDEO_EXTS = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);

export type ImportOrphanCandidate = {
  path: string;
  diskPath: string;
  type: "image" | "video";
  sizeBytes: number;
  mtime: string;
  ageHours: number;
};

export type ImportOrphanScanResult = {
  cooldownHours: number;
  cutoff: string;
  scannedAt: string;
  importsRoot: string;
  totalCount: number;
  totalBytes: number;
  candidates: ImportOrphanCandidate[];
};

export type ImportOrphanDeleteResult = ImportOrphanScanResult & {
  deletedCount: number;
  deletedBytes: number;
  failed: Array<{ path: string; error: string }>;
};

type ScanOptions = {
  now?: Date;
  importsRoot?: string;
  cooldownHours?: number;
  protectedRefs?: Set<string>;
};

function normalizeCooldownHours(value: unknown) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return IMPORT_ORPHAN_COOLDOWN_HOURS;
  return Math.max(1, Math.floor(n));
}

function isInsideDir(rootDir: string, targetPath: string) {
  const root = path.resolve(rootDir);
  const target = path.resolve(targetPath);
  const rel = path.relative(root, target);
  return !!rel && rel !== "." && !rel.startsWith("..") && !path.isAbsolute(rel);
}

function mediaTypeForPath(filePath: string): "image" | "video" | null {
  const ext = path.extname(filePath).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return "image";
  if (VIDEO_EXTS.has(ext)) return "video";
  return null;
}

function addComparableRefs(value: unknown, refs: Set<string>) {
  const rawRefs = new Set<string>();
  collectMediaRefs(value, rawRefs);
  for (const ref of rawRefs) {
    const comparable = normalizeComparableMediaRef(ref);
    if (comparable) refs.add(comparable);
  }
}

function importsComparablePath(importsRoot: string, diskPath: string) {
  if (!isInsideDir(importsRoot, diskPath)) return "";
  const rel = path.relative(importsRoot, diskPath).replaceAll(path.sep, "/");
  return `/uploads/imports/${rel}`;
}

async function walkMediaFiles(rootDir: string) {
  const out: string[] = [];
  const exists = await fs.pathExists(rootDir);
  if (!exists) return out;

  async function walk(dir: string) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && mediaTypeForPath(fullPath)) {
        out.push(fullPath);
      }
    }
  }

  await walk(rootDir);
  return out;
}

async function collectRowsInBatches<T>(
  load: (cursor: number) => Promise<T[]>,
  add: (row: T) => void | Promise<void>,
  getCursor: (row: T) => number
) {
  let cursor = 0;
  while (true) {
    const rows = await load(cursor);
    if (!rows.length) break;
    for (const row of rows) await add(row);
    cursor = Math.max(...rows.map(getCursor));
  }
}

export async function collectProtectedImportRefs() {
  const refs = new Set<string>();
  const BATCH = 500;

  await collectRowsInBatches(
    (cursor) =>
      prisma.generation.findMany({
        where: cursor > 0 ? { id: { gt: cursor } } : {},
        orderBy: { id: "asc" },
        take: BATCH,
        select: { id: true, localPath: true, templateData: true }
      }),
    (row) => {
      addComparableRefs(row.localPath, refs);
      addComparableRefs(row.templateData, refs);
    },
    (row) => row.id
  );

  await collectRowsInBatches(
    (cursor) =>
      prisma.log.findMany({
        where: cursor > 0 ? { id: { gt: cursor } } : {},
        orderBy: { id: "asc" },
        take: BATCH,
        select: { id: true, metadata: true }
      }),
    (row) => addComparableRefs(row.metadata, refs),
    (row) => row.id
  );

  const [
    adminAssets,
    appSettings,
    canvases,
    mediaItems,
    materialAssets,
    materialEvents,
    templates,
    ledgers,
    agentMessages,
    userMemories
  ] = await Promise.all([
    prisma.adminAssetFeed.findMany({
      select: { thumbUrl: true, displayUrl: true, previewUrl: true, posterUrl: true, localPath: true, outputPaths: true, inputMaterials: true }
    }),
    prisma.appSetting.findMany({ select: { value: true } }),
    prisma.canvas.findMany({ select: { data: true, thumbnail: true } }),
    prisma.mediaLibraryItem.findMany({ select: { fileUrl: true, thumbnailUrl: true } }),
    prisma.materialAsset.findMany({ select: { imageUrl: true, thumbnailUrl: true, previewUrl: true, media: true, inspiration: true } }),
    prisma.materialAssetSelectionEvent.findMany({
      select: { assetImageUrl: true, assetThumbnailUrl: true, selectedMediaUrl: true }
    }),
    prisma.template.findMany({ select: { previewImagePath: true, previewVideoPath: true } }),
    prisma.usageLedger.findMany({ select: { pricingSnapshot: true, requestSnapshot: true, usageSnapshot: true } }),
    prisma.agentMessage.findMany({ select: { content: true, metadata: true } }),
    prisma.userMemory.findMany({ select: { value: true, history: true } })
  ]);

  for (const row of adminAssets) {
    addComparableRefs(row.thumbUrl, refs);
    addComparableRefs(row.displayUrl, refs);
    addComparableRefs(row.previewUrl, refs);
    addComparableRefs(row.posterUrl, refs);
    addComparableRefs(row.localPath, refs);
    addComparableRefs(row.outputPaths, refs);
    addComparableRefs(row.inputMaterials, refs);
  }
  for (const row of appSettings) addComparableRefs(row.value, refs);
  for (const row of canvases) {
    addComparableRefs(row.data, refs);
    addComparableRefs(row.thumbnail, refs);
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
    addComparableRefs(row.inspiration, refs);
  }
  for (const row of materialEvents) {
    addComparableRefs(row.assetImageUrl, refs);
    addComparableRefs(row.assetThumbnailUrl, refs);
    addComparableRefs(row.selectedMediaUrl, refs);
  }
  for (const row of templates) {
    addComparableRefs(row.previewImagePath, refs);
    addComparableRefs(row.previewVideoPath, refs);
  }
  for (const row of ledgers) {
    addComparableRefs(row.pricingSnapshot, refs);
    addComparableRefs(row.requestSnapshot, refs);
    addComparableRefs(row.usageSnapshot, refs);
  }
  for (const row of agentMessages) {
    addComparableRefs(row.content, refs);
    addComparableRefs(row.metadata, refs);
  }
  for (const row of userMemories) {
    addComparableRefs(row.value, refs);
    addComparableRefs(row.history, refs);
  }

  return refs;
}

export async function scanImportOrphanCandidates(options: ScanOptions = {}): Promise<ImportOrphanScanResult> {
  const now = options.now || new Date();
  const cooldownHours = normalizeCooldownHours(options.cooldownHours);
  const cutoffMs = now.getTime() - cooldownHours * 60 * 60 * 1000;
  const importsRoot = path.resolve(options.importsRoot || resolvePublicPath("uploads", "imports"));
  const protectedRefs = options.protectedRefs || (await collectProtectedImportRefs());
  const diskPaths = await walkMediaFiles(importsRoot);
  const candidates: ImportOrphanCandidate[] = [];

  for (const diskPath of diskPaths) {
    if (!isInsideDir(importsRoot, diskPath)) continue;
    const type = mediaTypeForPath(diskPath);
    if (!type) continue;
    const stat = await fs.stat(diskPath).catch(() => null);
    if (!stat?.isFile()) continue;
    if (stat.mtimeMs >= cutoffMs) continue;
    const comparable = importsComparablePath(importsRoot, diskPath);
    if (!comparable || protectedRefs.has(comparable)) continue;
    candidates.push({
      path: comparable,
      diskPath,
      type,
      sizeBytes: Number(stat.size || 0),
      mtime: stat.mtime.toISOString(),
      ageHours: Math.max(0, Math.floor((now.getTime() - stat.mtimeMs) / (60 * 60 * 1000)))
    });
  }

  candidates.sort((a, b) => a.mtime.localeCompare(b.mtime) || a.path.localeCompare(b.path));
  const totalBytes = candidates.reduce((sum, item) => sum + item.sizeBytes, 0);
  return {
    cooldownHours,
    cutoff: new Date(cutoffMs).toISOString(),
    scannedAt: now.toISOString(),
    importsRoot,
    totalCount: candidates.length,
    totalBytes,
    candidates
  };
}

export async function deleteImportOrphanCandidates(options: ScanOptions = {}): Promise<ImportOrphanDeleteResult> {
  const scan = await scanImportOrphanCandidates(options);
  let deletedCount = 0;
  let deletedBytes = 0;
  const failed: Array<{ path: string; error: string }> = [];

  for (const item of scan.candidates) {
    if (!isInsideDir(scan.importsRoot, item.diskPath)) {
      failed.push({ path: item.path, error: "路径不在 imports 目录内" });
      continue;
    }
    try {
      await fs.remove(item.diskPath);
      deletedCount += 1;
      deletedBytes += item.sizeBytes;
    } catch (error) {
      failed.push({ path: item.path, error: error instanceof Error ? error.message : "删除失败" });
    }
  }

  return {
    ...scan,
    deletedCount,
    deletedBytes,
    failed
  };
}
