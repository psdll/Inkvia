import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import crypto from "node:crypto";
import path from "node:path";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { getThumbnailCacheKey } from "../lib/thumbnail-cache-key.mjs";

const HELP = `Usage: node scripts/backfill-admin-thumbnails.mjs [options]

Options:
  --days <n>           Only scan generations created in the last n days
  --admin-key <key>    Limit to auth:<id> or guest:<device-id>
  --batch-size <n>     Database batch size, 1..1000 (default: 200)
  --width <n>          Thumbnail width: 300 or 600 (default: 600)
  --concurrency <n>    Background conversions, 1..4 (default: 4)
  --dry-run            Count missing thumbnails without writing files
  --cursor <id>        Resume after this Generation id (default: 0)
  --help               Show this help

Recommended server order:
  1. --days 30
  2. --admin-key <high-output-user> for each high-output user
  3. --days 60
  4. no scope filter for the remaining history

Each completed batch prints nextCursor=<generation-id>. Re-run with that value
after interruption; existing valid cache files are skipped idempotently.`;

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tiff", ".avif"]);
const DISPLAY_KEYS = new Set([
  "outputThumbUrl",
  "outputPreviewUrl",
  "outputPosterUrl",
  "outputDisplayUrl",
  "thumbUrl",
  "previewUrl",
  "posterUrl",
  "displayUrl",
  "outputPath",
  "outputPaths",
  "resultUrls",
  "output_images",
]);

export const getBackfillThumbnailCacheKey = getThumbnailCacheKey;

function readOption(argv, name) {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function parseBackfillOptions(argv) {
  const numberOption = (name, fallback, min, max) => {
    const raw = readOption(argv, name);
    if (raw === undefined) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) throw new Error(`invalid ${name}`);
    return value;
  };
  const adminKey = String(readOption(argv, "--admin-key") || "").trim();
  if (adminKey && !/^auth:\d+$/.test(adminKey) && !/^guest:.+/.test(adminKey)) {
    throw new Error("invalid --admin-key; expected auth:<id> or guest:<device-id>");
  }
  const width = numberOption("--width", 600, 300, 600);
  if (![300, 600].includes(width)) throw new Error("invalid --width; expected 300 or 600");
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    days: readOption(argv, "--days") === undefined ? null : numberOption("--days", 0, 1, 36500),
    adminKey: adminKey || null,
    batchSize: numberOption("--batch-size", 200, 1, 1000),
    width,
    concurrency: numberOption("--concurrency", 4, 1, 4),
    dryRun: argv.includes("--dry-run"),
    cursor: numberOption("--cursor", 0, 0, Number.MAX_SAFE_INTEGER),
  };
}

function collectDisplayValues(value, output, depth = 0) {
  if (!value || depth > 8) return;
  if (Array.isArray(value)) {
    for (const item of value) collectDisplayValues(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (DISPLAY_KEYS.has(key)) {
      if (typeof nested === "string") output.push(nested);
      else if (Array.isArray(nested)) {
        for (const item of nested) if (typeof item === "string") output.push(item);
      }
    }
    collectDisplayValues(nested, output, depth + 1);
  }
}

function normalizeUploadUrl(value) {
  const clean = String(value || "").trim().replace(/\\/g, "/");
  if (clean.startsWith("/uploads/")) return clean;
  if (clean.startsWith("uploads/")) return `/${clean}`;
  return null;
}

export function selectGenerationImageSource(row) {
  const candidates = [];
  if (row.templateData) {
    try {
      const meta = JSON.parse(row.templateData);
      // Match the card's preferred source, independent of JSON property order.
      candidates.push(meta?.outputThumbUrl, meta?.outputPosterUrl, meta?.outputPreviewUrl, meta?.outputDisplayUrl);
      collectDisplayValues(meta, candidates);
    } catch {
      // Malformed legacy template snapshots are skipped in favor of localPath.
    }
  }
  candidates.push(row.localPath);
  for (const candidate of candidates) {
    const normalized = normalizeUploadUrl(candidate);
    if (!normalized || !IMAGE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) continue;
    return normalized;
  }
  return null;
}

function resolveUploadPath(uploadUrl, uploadsRoot) {
  const relative = uploadUrl.slice("/uploads/".length);
  if (!relative || relative.includes("..") || relative.includes("\0")) return null;
  const absolute = path.resolve(uploadsRoot, relative);
  const root = path.resolve(uploadsRoot);
  return absolute.startsWith(`${root}${path.sep}`) ? absolute : null;
}

async function writeAtomic(targetPath, buffer) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  const tempPath = `${targetPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let handle = null;
  try {
    handle = await open(tempPath, "wx");
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await rename(tempPath, targetPath);
    } catch (error) {
      const raced = await stat(targetPath).catch(() => null);
      if (!raced || raced.size <= 0) throw error;
    }
  } finally {
    if (handle) await handle.close().catch(() => {});
    await rm(tempPath, { force: true }).catch(() => {});
  }
}

function buildWhere(options) {
  const where = { id: { gt: options.cursor } };
  if (options.days) where.createdAt = { gte: new Date(Date.now() - options.days * 24 * 60 * 60 * 1000) };
  if (options.adminKey?.startsWith("auth:")) where.authUserId = Number(options.adminKey.slice(5));
  if (options.adminKey?.startsWith("guest:")) {
    where.authUserId = null;
    where.userId = options.adminKey.slice(6);
  }
  return where;
}

async function processGeneration(row, context) {
  const uploadUrl = selectGenerationImageSource(row);
  if (!uploadUrl) {
    context.stats.noSource += 1;
    return;
  }
  const sourcePath = resolveUploadPath(uploadUrl, context.uploadsRoot);
  if (!sourcePath) {
    context.stats.noSource += 1;
    return;
  }
  const sourceStat = await stat(sourcePath).catch(() => null);
  if (!sourceStat?.isFile()) {
    context.stats.missingSource += 1;
    return;
  }
  const width = context.options.width || 600;
  const key = getThumbnailCacheKey({ sourcePath, sourceMtimeMs: sourceStat.mtimeMs, width, quality: 88 });
  const cachePath = path.join(context.cacheDir, `${key}.webp`);
  const cached = await stat(cachePath).catch(() => null);
  if (cached?.isFile() && cached.size > 0) {
    context.stats.hits += 1;
    return;
  }
  context.stats.missing += 1;
  if (context.options.dryRun) return;
  const buffer = await sharp(sourcePath, { failOn: "none" })
    .rotate()
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 88, effort: 4 })
    .toBuffer();
  if (!buffer.length) throw new Error(`empty thumbnail for generation ${row.id}`);
  await writeAtomic(cachePath, buffer);
  context.stats.generated += 1;
}

async function processBatch(rows, context) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(context.options.concurrency || 4, rows.length) }, async () => {
    while (index < rows.length) {
      const row = rows[index++];
      await processGeneration(row, context);
    }
  }));
}

export async function runBackfill(options, dependencies = {}) {
  const prisma = dependencies.prisma || createGuardedPrismaClient();
  const ownsPrisma = !dependencies.prisma;
  const uploadsRoot = path.resolve(String(process.env.UPLOADS_DIR || path.join(process.cwd(), "public", "uploads")));
  const context = {
    options,
    uploadsRoot,
    cacheDir: path.join(uploadsRoot, "_thumbs"),
    stats: { scanned: 0, hits: 0, missing: 0, generated: 0, noSource: 0, missingSource: 0 },
  };
  let cursor = options.cursor;
  try {
    while (true) {
      const rows = await prisma.generation.findMany({
        where: buildWhere({ ...options, cursor }),
        orderBy: { id: "asc" },
        take: options.batchSize,
        select: {
          id: true,
          userId: true,
          authUserId: true,
          localPath: true,
          templateData: true,
          createdAt: true,
        },
      });
      if (!rows.length) break;
      await processBatch(rows, context);
      context.stats.scanned += rows.length;
      cursor = rows[rows.length - 1].id;
      console.log(JSON.stringify({ ...context.stats, batch: rows.length, nextCursor: cursor, dryRun: options.dryRun }));
      console.log(`nextCursor=${cursor}`);
      if (rows.length < options.batchSize) break;
    }
    return { ...context.stats, nextCursor: cursor };
  } finally {
    if (ownsPrisma) await prisma.$disconnect();
  }
}

async function main() {
  const options = parseBackfillOptions(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const result = await runBackfill(options);
  console.log(JSON.stringify({ done: true, ...result, dryRun: options.dryRun }));
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
