import { createGuardedPrismaClient } from "./lib/runtime-isolation.cjs";
import { PrismaClient } from "@prisma/client";

const prisma = createGuardedPrismaClient();
const batchSize = Math.max(50, Math.min(1000, Number(process.env.BATCH_SIZE || 500)));

function parseJson(raw) {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function normalizeMediaUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  return raw.replace(/\\/g, "/");
}

function toArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeMediaUrl(item)).filter(Boolean);
}

function isVideo(type, url) {
  const t = String(type || "").toLowerCase();
  const u = String(url || "").toLowerCase().split("?")[0];
  return t === "video_gen" || t === "video_generate" || /\.(mp4|webm|mov|m4v)$/.test(u);
}

function displayFields(row, meta) {
  const localPath = normalizeMediaUrl(row.localPath);
  const displayUrl = normalizeMediaUrl(meta?.outputDisplayUrl || meta?.outputPreviewUrl || meta?.outputPosterUrl || meta?.displayUrl || localPath);
  const posterUrl = normalizeMediaUrl(meta?.outputPosterUrl);
  const previewUrl = normalizeMediaUrl(meta?.outputPreviewUrl);
  const thumbUrl = normalizeMediaUrl(meta?.outputThumbUrl);
  const mediaKind = isVideo(row.type, localPath) ? "video" : "image";
  return {
    mediaKind,
    displayUrl: displayUrl || null,
    previewUrl: previewUrl || (posterUrl ? null : displayUrl || null),
    posterUrl: posterUrl || null,
    thumbUrl: thumbUrl || previewUrl || posterUrl || displayUrl || null,
  };
}

function outputPaths(row, meta) {
  const values = [
    normalizeMediaUrl(row.localPath),
    ...toArray(meta?.outputPaths),
    ...toArray(meta?.output_images),
    ...toArray(meta?.image_urls),
    ...toArray(meta?.resultUrls),
  ];
  if (Array.isArray(meta?.outputs)) {
    for (const item of meta.outputs) values.push(normalizeMediaUrl(item?.url || item?.video_url || item));
  }
  return Array.from(new Set(values.filter(Boolean)));
}

function inputMaterials(row, meta) {
  const values = [
    ...toArray(meta?.imagePaths),
    ...toArray(meta?.inputImages),
    ...toArray(meta?.inputPaths),
    ...toArray(meta?.sourceImages),
    ...toArray(meta?.fileUrls),
    ...toArray(meta?.image_urls),
    normalizeMediaUrl(meta?.imagePath),
    normalizeMediaUrl(meta?.sourcePath),
    normalizeMediaUrl(meta?.mediaPath),
    normalizeMediaUrl(meta?.localInputPath),
    normalizeMediaUrl(meta?.facePath),
    normalizeMediaUrl(meta?.targetPath),
    normalizeMediaUrl(meta?.fileUrl),
    normalizeMediaUrl(meta?.inputUrl || meta?.image_url),
  ];
  if (Array.isArray(meta?.inputMedia)) {
    for (const item of meta.inputMedia) values.push(normalizeMediaUrl(item?.url || item));
  }
  return Array.from(new Set(values.filter(Boolean))).slice(0, 12);
}

function feedData(row) {
  const meta = parseJson(row.templateData) || {};
  const display = displayFields(row, meta);
  return {
    generationId: row.id,
    userId: row.userId,
    authUserId: typeof row.authUserId === "number" ? row.authUserId : null,
    type: row.type,
    status: row.status,
    mediaKind: display.mediaKind,
    thumbUrl: display.thumbUrl,
    displayUrl: display.displayUrl,
    previewUrl: display.previewUrl,
    posterUrl: display.posterUrl,
    localPath: row.localPath || null,
    outputPaths: outputPaths(row, meta),
    inputMaterials: inputMaterials(row, meta),
    errorMsg: row.errorMsg || null,
    externalTaskId: row.externalTaskId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt || null,
    deletedAt: null,
  };
}

async function main() {
  let cursor = 0;
  let total = 0;
  for (;;) {
    const rows = await prisma.generation.findMany({
      where: { id: { gt: cursor } },
      orderBy: { id: "asc" },
      take: batchSize,
      select: {
        id: true,
        userId: true,
        authUserId: true,
        type: true,
        status: true,
        externalTaskId: true,
        errorMsg: true,
        localPath: true,
        templateData: true,
        createdAt: true,
        updatedAt: true,
        finishedAt: true,
      },
    });
    if (!rows.length) break;
    for (const row of rows) {
      const data = feedData(row);
      await prisma.adminAssetFeed.upsert({
        where: { generationId: row.id },
        create: data,
        update: data,
      });
    }
    cursor = rows[rows.length - 1].id;
    total += rows.length;
    console.log(`backfilled ${total} admin asset feed rows`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
