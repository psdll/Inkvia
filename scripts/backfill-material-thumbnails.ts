/** Prepare existing material card previews without changing originals or database rows. */
import path from "node:path";
import { stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import type { PrismaClient } from "@prisma/client";
import { MATERIAL_CARD_PREVIEW_WIDTH, materialCardImageCandidates, materialCardVideoPosterCandidates } from "../lib/material-card-preview";
import { isVideoMediaUrl } from "../lib/media-url";
import { isPrivateUploadPath } from "../lib/private-upload-path";
import { createThumbnailCache, getThumbnailCacheKey } from "../lib/thumbnail-cache";
import { assertWritablePath, createGuardedPrismaClient, getRuntimePolicy, prepareRuntime } from "./lib/runtime-isolation.cjs";

type Options = { apply: boolean; after: number; limit: number };
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".avif"]);

export function parseMaterialThumbnailOptions(args: string[]): Options {
  const readNumber = (name: string, fallback: number, min: number, max: number) => {
    const raw = args.find(arg => arg.startsWith(`--${name}=`))?.split("=")[1];
    const value = raw === undefined ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`invalid --${name}`);
    return value;
  };
  for (const arg of args) {
    if (arg !== "--apply" && !/^--(?:after|limit)=/.test(arg)) throw new Error(`unknown option: ${arg}`);
  }
  return { apply: args.includes("--apply"), after: readNumber("after", 0, 0, Number.MAX_SAFE_INTEGER), limit: readNumber("limit", 200, 1, 10000) };
}

export async function backfillMaterialThumbnails(
  options: Options,
  dependencies: { prisma: Pick<PrismaClient, "materialAsset">; uploadsRoot: string; progress?: (stats: unknown) => void },
) {
  const uploadsRoot = path.resolve(dependencies.uploadsRoot);
  const cacheDir = path.join(uploadsRoot, "_thumbs");
  const cache = createThumbnailCache({ concurrency: 1 });
  const stats = { apply: options.apply, scanned: 0, prepared: 0, hits: 0, missing: 0, generated: 0, generatedBytes: 0, skipped: 0, missingSource: 0, failed: 0, nextAfter: options.after };
  while (stats.scanned < options.limit) {
    const rows = await dependencies.prisma.materialAsset.findMany({
      where: { isDeleted: false, id: { gt: stats.nextAfter } },
      select: { id: true, imageUrl: true, thumbnailUrl: true, previewUrl: true, mimeType: true, media: true },
      orderBy: { id: "asc" }, take: Math.min(50, options.limit - stats.scanned),
    });
    if (!rows.length) break;
    for (const row of rows) {
      stats.scanned++;
      stats.nextAfter = row.id;
      try {
        const mediaItems = Array.isArray(row.media) ? row.media as Array<{ width?: number }> : [];
        const source = { ...row, mediaItems };
        const video = row.mimeType?.startsWith("video/") || isVideoMediaUrl(row.imageUrl);
        const candidate = (video ? materialCardVideoPosterCandidates(source) : materialCardImageCandidates(source))[0];
        const request = candidate?.startsWith("/api/thumb?") ? new URL(candidate, "http://local") : null;
        const uploadUrl = request ? request.searchParams.get("src") || "" : candidate || "";
        if (!uploadUrl.startsWith("/uploads/")) { stats.skipped++; continue; }
        const relative = uploadUrl.slice("/uploads/".length);
        const sourcePath = path.resolve(uploadsRoot, relative);
        if (relative.includes("..") || relative.includes("\0") || isPrivateUploadPath(relative)
          || !sourcePath.startsWith(uploadsRoot + path.sep) || !imageExtensions.has(path.extname(sourcePath).toLowerCase())) {
          stats.skipped++; continue;
        }
        const sourceStat = await stat(sourcePath).catch(() => null);
        if (!sourceStat?.isFile()) { stats.missingSource++; continue; }
        // New uploads already have a directly usable card image, including
        // smaller originals which should never be enlarged to 1200px.
        if (!request) { stats.prepared++; continue; }
        const input = { sourcePath, sourceMtimeMs: sourceStat.mtimeMs, width: MATERIAL_CARD_PREVIEW_WIDTH, cacheDir };
        const existing = await stat(path.join(cacheDir, `${getThumbnailCacheKey(input)}.webp`)).catch(() => null);
        if (existing?.isFile() && existing.size > 0) { stats.hits++; continue; }
        stats.missing++;
        if (!options.apply) continue;
        const result = await cache.ensureThumbnail({
          ...input,
          convert: () => sharp(sourcePath, { failOn: "none" }).rotate()
            .resize({ width: MATERIAL_CARD_PREVIEW_WIDTH, withoutEnlargement: true }).webp({ quality: 88, effort: 4 }).toBuffer(),
        });
        if (result.status === "generated") { stats.generated++; stats.generatedBytes += result.buffer.length; }
        else stats.hits++;
      } catch {
        stats.failed++;
        dependencies.progress?.({ failedMaterialId: row.id });
      }
    }
    dependencies.progress?.({ ...stats });
  }
  return stats;
}

async function main() {
  if (process.argv.includes("--help")) {
    console.log("Preview material card cache gaps (default dry run). Options: --apply --limit=200 --after=0. Only writes missing _thumbs files; never edits database rows. Resume with nextAfter; rerunning safely skips existing files. Use runtime-command.cjs with the intended runtime profile.");
    return;
  }
  const options = parseMaterialThumbnailOptions(process.argv.slice(2));
  await prepareRuntime();
  const policy = getRuntimePolicy();
  const uploadsRoot = path.resolve(process.env.UPLOADS_DIR || path.join(policy.projectRoot, "public", "uploads"));
  assertWritablePath(path.join(uploadsRoot, "_thumbs"));
  console.log(JSON.stringify({ profile: policy.profile, database: policy.database.databaseName, endpoint: policy.database.endpointId, uploadsRoot, ...options }));
  const prisma = createGuardedPrismaClient();
  try {
    const result = await backfillMaterialThumbnails(options, { prisma, uploadsRoot, progress: stats => console.log(JSON.stringify(stats)) });
    console.log(JSON.stringify({ done: true, ...result }));
    if (result.failed) process.exitCode = 1;
  } finally { await prisma.$disconnect(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  void main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
