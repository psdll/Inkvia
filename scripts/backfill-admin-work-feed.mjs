import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
import { PrismaClient } from "@prisma/client";
import path from "node:path";
import { pathToFileURL } from "node:url";

const STATE_KEY = "admin_work_feed_backfill_state";

const HELP = `Usage: node scripts/backfill-admin-work-feed.mjs [options]

Options:
  --batch-size <n>    Rows per completed batch, 500..1000 (default: 1000)
  --cursor <id>       Resume after this Generation id (default: saved state or 0)
  --high-water-id <id> Keep the original Generation high-water mark when resuming
  --dry-run           Scan without writing AdminWorkFeed or backfill state
  --help              Show this help

The script records event and Generation high-water marks before scanning. Every
completed batch persists and prints nextCursor=<generation-id>. Projection rows
use sourceEventId=0, so real-time events always win.`;

function readOption(argv, name) {
  const inline = argv.find((item) => item.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

function integerOption(argv, name, fallback, min, max) {
  const raw = readOption(argv, name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`invalid ${name}`);
  return value;
}

export function parseBackfillOptions(argv) {
  const highWaterRaw = readOption(argv, "--high-water-id");
  return {
    help: argv.includes("--help") || argv.includes("-h"),
    batchSize: integerOption(argv, "--batch-size", 1000, 500, 1000),
    cursor: integerOption(argv, "--cursor", 0, 0, Number.MAX_SAFE_INTEGER),
    highWaterId: highWaterRaw === undefined
      ? null
      : integerOption(argv, "--high-water-id", 0, 0, Number.MAX_SAFE_INTEGER),
    dryRun: argv.includes("--dry-run"),
  };
}

function normalizeMediaUrl(value) {
  return String(value || "").trim().replace(/\\/g, "/");
}

function parseTemplateData(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isVideoGeneration(type, url) {
  const normalizedType = String(type || "").toLowerCase();
  return normalizedType === "video_gen"
    || normalizedType === "video_generate"
    || /\.(mp4|webm|mov|m4v|avi|mkv)(?:$|[?#])/i.test(String(url || ""));
}

export function buildWorkFeedProjection(row) {
  const meta = parseTemplateData(row.templateData);
  const localPath = normalizeMediaUrl(row.localPath);
  const isAudio = row.type === "audio_gen" || /\.(mp3|wav|m4a|aac|ogg|flac)(?:$|[?#])/i.test(localPath);
  const displayUrl = normalizeMediaUrl(
    meta?.outputDisplayUrl || meta?.outputPreviewUrl || meta?.outputPosterUrl || meta?.displayUrl || localPath,
  );
  const posterUrl = normalizeMediaUrl(meta?.outputPosterUrl);
  const previewUrl = normalizeMediaUrl(meta?.outputPreviewUrl);
  const thumbUrl = normalizeMediaUrl(meta?.outputThumbUrl) || previewUrl || posterUrl || displayUrl;
  const sizeBytes64 = typeof row.sizeBytes === "bigint"
    ? row.sizeBytes
    : typeof row.sizeBytes === "number" && Number.isFinite(row.sizeBytes)
      ? BigInt(Math.max(0, Math.floor(row.sizeBytes)))
      : null;
  return {
    generationId: Number(row.id),
    sourceEventId: 0,
    userId: String(row.userId || "legacy"),
    authUserId: typeof row.authUserId === "number" ? row.authUserId : null,
    type: String(row.type || "unknown"),
    status: String(row.status || "unknown"),
    source: String(row.source || "tool"),
    provider: row.externalProvider || null,
    model: row.model || null,
    mediaKind: isAudio ? "audio" : isVideoGeneration(row.type, localPath) ? "video" : "image",
    thumbUrl: isAudio ? null : thumbUrl || null,
    previewUrl: isAudio ? null : previewUrl || (posterUrl ? null : displayUrl || null),
    displayUrl: isAudio ? localPath || null : displayUrl || null,
    posterUrl: isAudio ? null : posterUrl || null,
    sizeBytes: typeof row.sizeBytes === "number" && row.sizeBytes <= 2_147_483_647 ? row.sizeBytes : null,
    sizeBytes64,
    errorCode: meta?.errorCode ? String(meta.errorCode) : null,
    errorMsg: row.errorMsg || null,
    createdAt: row.createdAt,
    finishedAt: row.finishedAt || null,
    updatedAt: row.updatedAt || row.createdAt,
    deletedAt: null,
  };
}

async function projectRow(db, data) {
  return db.$executeRawUnsafe(
    `INSERT INTO "AdminWorkFeed" (
       "generationId", "sourceEventId", "userId", "authUserId", "type", "status", "source",
       "provider", "model", "mediaKind", "thumbUrl", "previewUrl", "displayUrl", "posterUrl",
       "sizeBytes", "sizeBytes64", "errorCode", "errorMsg", "createdAt", "finishedAt", "updatedAt", "deletedAt"
     ) VALUES (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
     )
     ON CONFLICT ("generationId") DO UPDATE SET
       "userId" = EXCLUDED."userId", "authUserId" = EXCLUDED."authUserId",
       "type" = EXCLUDED."type", "status" = EXCLUDED."status", "source" = EXCLUDED."source",
       "provider" = EXCLUDED."provider", "model" = EXCLUDED."model", "mediaKind" = EXCLUDED."mediaKind",
       "thumbUrl" = EXCLUDED."thumbUrl", "previewUrl" = EXCLUDED."previewUrl",
       "displayUrl" = EXCLUDED."displayUrl", "posterUrl" = EXCLUDED."posterUrl",
       "sizeBytes" = EXCLUDED."sizeBytes", "sizeBytes64" = EXCLUDED."sizeBytes64",
       "errorCode" = EXCLUDED."errorCode", "errorMsg" = EXCLUDED."errorMsg",
       "createdAt" = EXCLUDED."createdAt", "finishedAt" = EXCLUDED."finishedAt",
       "updatedAt" = EXCLUDED."updatedAt", "deletedAt" = EXCLUDED."deletedAt"
     WHERE "AdminWorkFeed"."sourceEventId" <= EXCLUDED."sourceEventId"`,
    data.generationId, data.sourceEventId, data.userId, data.authUserId, data.type, data.status, data.source,
    data.provider, data.model, data.mediaKind, data.thumbUrl, data.previewUrl, data.displayUrl, data.posterUrl,
    data.sizeBytes, data.sizeBytes64, data.errorCode, data.errorMsg, data.createdAt, data.finishedAt,
    data.updatedAt, data.deletedAt,
  );
}

async function runBatch(rows, context) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(8, rows.length) }, async () => {
    while (index < rows.length) {
      const row = rows[index++];
      if (!context.options.dryRun) {
        const changed = await projectRow(context.db, buildWorkFeedProjection(row));
        if (Number(changed || 0) === 0) context.stale += 1;
        else context.projected += 1;
      }
    }
  }));
}

async function persistState(db, state) {
  await db.appSetting.upsert({
    where: { key: STATE_KEY },
    create: { key: STATE_KEY, value: JSON.stringify(state) },
    update: { value: JSON.stringify(state) },
  });
}

export async function runBackfill(options, dependencies = {}) {
  const db = dependencies.prisma || createGuardedPrismaClient();
  const ownsPrisma = !dependencies.prisma;
  const startedAt = new Date().toISOString();
  try {
    const saved = options.cursor === 0 && options.highWaterId == null
      ? await db.appSetting.findUnique({ where: { key: STATE_KEY } }).catch(() => null)
      : null;
    let savedState = null;
    try { savedState = saved?.value ? JSON.parse(saved.value) : null; } catch {}
    const generationMax = await db.generation.aggregate({ _max: { id: true } });
    const eventMax = await db.adminEvent.aggregate({ _max: { id: true } });
    const generationHighWater = options.highWaterId
      ?? Number(savedState?.generationHighWater || generationMax._max.id || 0);
    const eventHighWater = Number(savedState?.eventHighWater || eventMax._max.id || 0);
    let cursor = Math.max(options.cursor, Number(savedState?.cursor || 0));
    const context = { db, options, projected: 0, stale: 0 };
    let scanned = 0;
    const state = { eventHighWater, generationHighWater, cursor, startedAt, completedAt: null };
    if (!options.dryRun) await persistState(db, state);
    console.log(JSON.stringify({ eventHighWater, generationHighWater, cursor, dryRun: options.dryRun }));

    while (cursor < generationHighWater) {
      const rows = await db.generation.findMany({
        where: { id: { gt: cursor, lte: generationHighWater } },
        orderBy: { id: "asc" },
        take: options.batchSize,
      });
      if (!rows.length) break;
      await runBatch(rows, context);
      scanned += rows.length;
      cursor = rows[rows.length - 1].id;
      state.cursor = cursor;
      if (!options.dryRun) await persistState(db, state);
      console.log(JSON.stringify({ scanned, projected: context.projected, stale: context.stale, nextCursor: cursor }));
      console.log(`nextCursor=${cursor}`);
      if (rows.length < options.batchSize) break;
    }
    state.completedAt = new Date().toISOString();
    if (!options.dryRun) await persistState(db, state);
    return { scanned, projected: context.projected, stale: context.stale, ...state };
  } finally {
    if (ownsPrisma) await db.$disconnect();
  }
}

async function main() {
  const options = parseBackfillOptions(process.argv.slice(2));
  if (options.help) {
    console.log(HELP);
    return;
  }
  const result = await runBackfill(options);
  console.log(JSON.stringify({ done: true, ...result }));
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
