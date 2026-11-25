import { apiErrorMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import fs from "fs-extra";
import { statfs } from "node:fs/promises";
import path from "path";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { requireAdminRequest } from "@/lib/admin-auth";import { listAdminUserSummaries } from "@/lib/admin-user-scope";
import { resolvePublicPath } from "@/lib/public-path";
import { computeDeletableRefsForGenerationIds, deleteStoredMediaRefs } from "@/lib/media-cleanup";
import { getOssPrefixStats, isOssReady } from "@/lib/oss";
import { scanStorageCategories, type StorageCategory, type StorageScanSnapshot } from "@/lib/admin-storage-scan";
import { STORAGE_SCAN_KEY } from "@/lib/server-bootstrap";
import { readRollupForLastNDays } from "@/lib/admin-analytics-rollup";
import { isAdminSummaryReadModelReady } from "@/lib/admin-user-summary-read-model";
import { loadAdminStorageReadModel } from "@/lib/admin-storage-read-model";
import { loadAdminModelUsageRows } from "@/lib/admin/model-call-source";
import { adminStartOfDay } from "@/lib/admin-analytics-time";
import { retentionCutoffWhere } from "@/lib/data-retention";
import { deleteGenerationRowsAndBatchCards } from "@/lib/generation-physical-delete";
import { enqueueMediaCleanupRetry, enqueueMediaCleanupRetryIfNeeded } from "@/lib/media-cleanup-retry";
import { cleanupStoredThumbnailAssets } from "@/lib/thumbnail-asset-cleanup";
import { isDesktopMode } from "@/lib/desktop-mode";

// Storage 体积扫描走"读缓存优先"路径：管理员请求时直接读 AppSetting 中的快照。
// 后台 cron 每 5 分钟刷新一次。缓存缺失或过旧时才走实时扫描兜底。
const STORAGE_SNAPSHOT_FRESH_MS = 15 * 60 * 1000; // 15 分钟内的快照仍认为新鲜
const ADMIN_CACHE_HEADERS = {
  "Cache-Control": "no-store",
};

async function loadCachedStorageSnapshot(): Promise<StorageScanSnapshot | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: STORAGE_SCAN_KEY } });
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as StorageScanSnapshot | null;
    if (!parsed || !Array.isArray(parsed.categories)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hasUploadsTree(snapshot: StorageScanSnapshot | null): boolean {
  return !!snapshot && Array.isArray((snapshot as StorageScanSnapshot).uploadsTree);
}

function isSnapshotFresh(snapshot: StorageScanSnapshot | null): boolean {
  if (!snapshot?.scannedAt) return false;
  const ts = new Date(snapshot.scannedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < STORAGE_SNAPSHOT_FRESH_MS;
}

let storageScanInFlight: Promise<StorageScanSnapshot> | null = null;
function refreshStorageSnapshot() {
  if (storageScanInFlight) return storageScanInFlight;
  const request = scanStorageCategories().then(async (fresh) => {
    await prisma.appSetting.upsert({
      where: { key: STORAGE_SCAN_KEY },
      create: { key: STORAGE_SCAN_KEY, value: JSON.stringify(fresh) },
      update: { value: JSON.stringify(fresh) },
    });
    return fresh;
  }).finally(() => { if (storageScanInFlight === request) storageScanInFlight = null; });
  storageScanInFlight = request;
  return request;
}
async function getStorageSnapshotOrScan(forceRefresh = false): Promise<StorageScanSnapshot> {
  const cached = await loadCachedStorageSnapshot();
  if (forceRefresh || !cached) return refreshStorageSnapshot();
  if (!isSnapshotFresh(cached) || !hasUploadsTree(cached)) void refreshStorageSnapshot().catch(() => {});
  return cached;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KEY_RETENTION_DAYS = "data_retention_days";
const KEY_LAST_PRUNED_AT = "data_retention_last_pruned_at";
const KEY_STORAGE_TOTAL_GB = "storage_total_gb";
const KEY_STORAGE_WARN_PERCENT = "storage_warn_percent";
const KEY_STORAGE_CRITICAL_PERCENT = "storage_critical_percent";

function bad(message: string, status = 400) {
  return NextResponse.json({ error: apiErrorMessage(message) }, { status });
}

function parsePositiveInt(v: unknown, fallback: number, min: number, max: number) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function getUploadsRootDir() {
  const configured = String(process.env.UPLOADS_DIR || "").trim();
  if (configured) return path.resolve(configured);
  return resolvePublicPath("uploads");
}

function envRetentionDays() {
  const raw = String(process.env.DATA_RETENTION_DAYS || process.env.LOG_RETENTION_DAYS || "").trim();
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return 15;
}

function envStorageTotalGB() {
  const n = Number(String(process.env.STORAGE_TOTAL_GB || "").trim());
  if (Number.isFinite(n) && n > 0) return n;
  return 10;
}

function envWarnPercent() {
  return parsePositiveInt(process.env.STORAGE_WARN_PERCENT, 70, 1, 99);
}

function envCriticalPercent(baseWarn: number) {
  return parsePositiveInt(process.env.STORAGE_CRITICAL_PERCENT, 85, baseWarn + 1, 100);
}

async function readSettings(keys: string[]) {
  try {
    const rows = await prisma.appSetting.findMany({ where: { key: { in: keys } } });
    const m = new Map<string, string>();
    for (const row of rows || []) m.set(String(row.key || ""), String(row.value || ""));
    return m;
  } catch {
    return new Map<string, string>();
  }
}

async function writeSetting(key: string, value: string) {
  await prisma.appSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}

async function retentionInfo() {
  try {
    const byKey = await readSettings([KEY_RETENTION_DAYS, KEY_LAST_PRUNED_AT]);
    const customDays = Number(byKey.get(KEY_RETENTION_DAYS) || "");
    const days = Number.isFinite(customDays) && customDays > 0 ? Math.floor(customDays) : envRetentionDays();
    return {
      retentionDays: days,
      lastPrunedAt: byKey.get(KEY_LAST_PRUNED_AT) || null
    };
  } catch {
    return {
      retentionDays: envRetentionDays(),
      lastPrunedAt: null as string | null
    };
  }
}

async function storageLimitsInfo() {
  const byKey = await readSettings([KEY_STORAGE_TOTAL_GB, KEY_STORAGE_WARN_PERCENT, KEY_STORAGE_CRITICAL_PERCENT]);
  const totalRaw = byKey.has(KEY_STORAGE_TOTAL_GB) ? Number(byKey.get(KEY_STORAGE_TOTAL_GB)) : NaN;
  const warnRaw = byKey.has(KEY_STORAGE_WARN_PERCENT) ? Number(byKey.get(KEY_STORAGE_WARN_PERCENT)) : NaN;
  const envWarn = envWarnPercent();
  const warnPercent = Number.isFinite(warnRaw) ? parsePositiveInt(warnRaw, envWarn, 1, 99) : envWarn;
  const criticalRaw = byKey.has(KEY_STORAGE_CRITICAL_PERCENT) ? Number(byKey.get(KEY_STORAGE_CRITICAL_PERCENT)) : NaN;
  const criticalPercent = Number.isFinite(criticalRaw)
    ? parsePositiveInt(criticalRaw, envCriticalPercent(warnPercent), warnPercent + 1, 100)
    : envCriticalPercent(warnPercent);
  const totalStorageGB = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : envStorageTotalGB();
  return { totalStorageGB, warnPercent, criticalPercent };
}

async function statPathSize(target: string): Promise<{ bytes: number; files: number }> {
  const exists = await fs.pathExists(target).catch(() => false);
  if (!exists) return { bytes: 0, files: 0 };
  const stack = [target];
  let bytes = 0;
  let files = 0;
  while (stack.length) {
    const current = stack.pop() as string;
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const st = await fs.stat(full).catch(() => null);
      if (!st) continue;
      files += 1;
      bytes += Number(st.size || 0);
    }
  }
  return { bytes, files };
}

type StorageCategoryDef = {
  folder: string;
  label: string;
  localDir: string;
  ossPrefix: string;
};

const STORAGE_CATEGORY_DEFS: StorageCategoryDef[] = [
  { folder: "canvas_imports", label: "画布导入素材", localDir: "canvas_imports", ossPrefix: "uploads/canvas_imports/" },
  { folder: "canvas_image_results", label: "画布图片结果", localDir: "canvas_image_results", ossPrefix: "uploads/canvas_image_results/" },
  { folder: "canvas_video_results", label: "画布视频结果", localDir: "canvas_video_results", ossPrefix: "uploads/canvas_video_results/" },
  { folder: "canvas_audio_results", label: "画布音频结果", localDir: "canvas_audio_results", ossPrefix: "uploads/canvas_audio_results/" },
  { folder: "canvas_voice_previews", label: "画布音色试听", localDir: "canvas_voice_previews", ossPrefix: "uploads/canvas_voice_previews/" },
  { folder: "imports", label: "导入素材", localDir: "imports", ossPrefix: "uploads/imports/" },
  { folder: "image_results", label: "创作图片结果", localDir: "image_results", ossPrefix: "uploads/image_results/" },
  { folder: "face_results", label: "换脸结果", localDir: "face_results", ossPrefix: "uploads/face_results/" },
  { folder: "video_results", label: "创作视频结果", localDir: "video_results", ossPrefix: "uploads/video_results/" },
  { folder: "products_shared_image", label: "产品库 / 共享图片", localDir: "products/shared/image", ossPrefix: "uploads/products/shared/image/" },
  { folder: "products_shared_video", label: "产品库 / 共享视频", localDir: "products/shared/video", ossPrefix: "uploads/products/shared/video/" },
  { folder: "products_private_total", label: "产品库 / 私有文件", localDir: "products/private", ossPrefix: "uploads/products/private/" },
  { folder: "material_library_total", label: "素材库", localDir: "material_library", ossPrefix: "uploads/material_library/" },
  { folder: "temp", label: "临时目录", localDir: "temp", ossPrefix: "uploads/temp/" },
  { folder: "presets", label: "预设文件", localDir: "presets", ossPrefix: "uploads/presets/" },
];

function enrichStorageCategory(category: StorageCategory, uploadsRoot: string) {
  const def = STORAGE_CATEGORY_DEFS.find((item) => item.folder === category.folder);
  const localRelativePath = def ? `uploads/${def.localDir}` : null;
  return {
    ...category,
    localRelativePath,
    localPath: def ? path.join(uploadsRoot, def.localDir) : null,
    ossPrefix: def?.ossPrefix || null,
  };
}

async function statStorageCategory(uploadsRoot: string, def: StorageCategoryDef, ossEnabled: boolean) {
  const [localStats, ossStats] = await Promise.all([
    statPathSize(path.join(uploadsRoot, def.localDir)),
    ossEnabled
      ? getOssPrefixStats(def.ossPrefix).catch(() => ({ bytes: 0, files: 0 }))
      : Promise.resolve({ bytes: 0, files: 0 }),
  ]);

  const hasLocal = localStats.bytes > 0 || localStats.files > 0;
  const hasOss = ossStats.bytes > 0 || ossStats.files > 0;

  return {
    folder: def.folder,
    label: def.label,
    bytes: localStats.bytes + ossStats.bytes,
    files: localStats.files + ossStats.files,
    source: hasLocal && hasOss ? "mixed" : hasOss ? "oss" : "local",
  };
}

async function cleanupOlderThan(rootDir: string, days: number) {
  const exists = await fs.pathExists(rootDir).catch(() => false);
  if (!exists) return { deletedFiles: 0, deletedBytes: 0, removedDirs: 0 };
  const safeDays = parsePositiveInt(days, 7, 1, 3650);
  const cutoff = Date.now() - safeDays * 24 * 60 * 60 * 1000;
  const stack = [rootDir];
  const dirs: string[] = [];
  let deletedFiles = 0;
  let deletedBytes = 0;
  while (stack.length) {
    const current = stack.pop() as string;
    dirs.push(current);
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const st = await fs.stat(full).catch(() => null);
      if (!st) continue;
      if (new Date(st.mtime).getTime() >= cutoff) continue;
      const size = Number(st.size || 0);
      const removed = await fs.remove(full).then(() => true).catch(() => false);
      if (!removed) continue;
      deletedFiles += 1;
      deletedBytes += size;
    }
  }
  dirs.sort((a, b) => b.length - a.length);
  let removedDirs = 0;
  for (const dir of dirs) {
    if (dir === rootDir) continue;
    const items = await fs.readdir(dir).catch(() => null);
    if (!items || items.length) continue;
    const removed = await fs.remove(dir).then(() => true).catch(() => false);
    if (removed) removedDirs += 1;
  }
  return { deletedFiles, deletedBytes, removedDirs };
}

function levelByPercent(usedPercent: number, warnPercent: number, criticalPercent: number) {
  if (usedPercent >= criticalPercent) return "critical";
  if (usedPercent >= warnPercent) return "warning";
  return "normal";
}

type AnalyticsTypeKey = "image" | "video" | "face" | "other";
type AnalyticsUserItem = {
  adminKey: string;
  userId: string;
  authUserId: number | null;
  username: string | null;
  generationCount: number;
  successCount: number;
  failedCount: number;
  generationShare: number;
  storageBytes: number;
  storageShare: number;
  avgBytesPerGeneration: number;
  lastCreatedAt: string | null;
  typeBreakdown: Record<AnalyticsTypeKey, number>;
  trend7: number[];
};

function analyticsUserDisplayName(username: string | null | undefined, userId: string | null | undefined) {
  const name = String(username || "").trim();
  if (name) return name;
  const uid = String(userId || "").trim();
  if (uid && !/^\d+$/.test(uid)) return uid;
  return "未命名用户";
}

function dayKeyLocal(value: Date | string) {
  const t = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(t.getTime())) return "";
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, "0");
  const d = String(t.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function createLastNDaysKeys(days: number) {
  const n = Math.max(1, Math.floor(days));
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  start.setDate(start.getDate() - (n - 1));
  const keys: string[] = [];
  for (let i = 0; i < n; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    keys.push(dayKeyLocal(d));
  }
  return keys;
}

function analyticsTypeByGenerationType(type: string): AnalyticsTypeKey {
  const t = String(type || "").toLowerCase();
  if (t.includes("video")) return "video";
  if (t.includes("face")) return "face";
  if (t.includes("image")) return "image";
  return "other";
}

function normalizeFailureReason(raw: string) {
  const text = String(raw || "").trim();
  if (!text) return "未知原因";
  const cleaned = text
    .replace(/^错误:\s*/i, "")
    .replace(/^error:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "未知原因";
  return cleaned.slice(0, 64);
}

function emptyTypeBreakdown() {
  return { image: 0, video: 0, face: 0, other: 0 };
}

function normalizeUploadPath(raw: string) {
  const input = String(raw || "").trim();
  if (!input) return "";
  let text = input.replaceAll("\\", "/");
  if (/^https?:\/\//i.test(text)) {
    try {
      const u = new URL(text);
      text = `${u.pathname}${u.search}${u.hash}`;
    } catch {
      return "";
    }
  }
  const idx = text.indexOf("/uploads/");
  if (idx >= 0) text = text.slice(idx);
  if (text.startsWith("uploads/")) text = `/${text}`;
  if (!text.startsWith("/uploads/")) return "";
  return text.split(/[?#]/)[0] || "";
}

function toDiskPath(uploadPath: string) {
  const safe = normalizeUploadPath(uploadPath);
  if (!safe) return "";
  const rel = safe.replace(/^\/+/, "");
  const abs = path.resolve(resolvePublicPath(rel));
  const uploadRoot = path.resolve(resolvePublicPath("uploads"));
  const relative = path.relative(uploadRoot, abs);
  if (!relative || relative === ".") return "";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return abs;
}

async function cleanupGenerationsWithFilesOlderThan(days: number) {
  const BATCH = 200;
  const safeDays = parsePositiveInt(days, 7, 1, 3650);
  const cutoff = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000);
  let deletedFiles = 0;
  let deletedBytes = 0;
  let deletedGenerations = 0;
  let deletedLogs = 0;
  let deletedLedgers = 0;
  let skippedSharedRefs = 0;
  let deletedLocalFiles = 0;
  let deletedOssObjects = 0;
  let skippedProtectedRefs = 0;
  let ossErrorCount = 0;

  while (true) {
    const rows = await prisma.generation.findMany({
      where: {
        ...retentionCutoffWhere(cutoff),
        localPath: { not: null }
      } as any,
      orderBy: { createdAt: "asc" },
      take: BATCH,
      select: { id: true, localPath: true }
    });
    if (!rows.length) break;

    const ids = rows.map((x) => x.id);

    // 关键修复：只删未被其他 generation / log / templateData 引用的资源，避免破图。
    const deletableRefs = await computeDeletableRefsForGenerationIds(ids);
    const deletableSet = new Set(deletableRefs);

    // 先统计跨 generation 的共享引用；这类引用不会进入实际文件删除。
    for (const row of rows) {
      const norm = normalizeUploadPath(String(row.localPath || ""));
      if (!norm) {
        if (row.localPath) skippedSharedRefs += 1;
        continue;
      }
      if (!deletableSet.has(norm)) {
        skippedSharedRefs += 1;
      }
    }

    // 提前记录本批安全候选文件的体积，删除后只统计确实已不存在的文件。
    const diskSizesToReport = new Map<string, number>();
    for (const ref of deletableRefs) {
      const disk = toDiskPath(ref);
      if (!disk || diskSizesToReport.has(disk)) continue;
      const st = await fs.stat(disk).catch(() => null);
      if (st && st.isFile()) diskSizesToReport.set(disk, Number(st.size || 0));
    }

    // 先删 DB 记录，再删资源（删 DB 失败时不会有"孤立的已删 OSS 对象 + 残留记录"）。
    const databaseDeletion = await prisma.$transaction(async (tx) => {
      const logsDeleted = await tx.log.deleteMany({ where: { generationId: { in: ids } } });
      // 费用账本独立保留；Generation 外键删除时置空，作品清理不改变历史账单。
      const ledgersDeleted = { count: 0 };
      const generationsDeleted = await deleteGenerationRowsAndBatchCards(tx, ids);
      return {
        logs: Number(logsDeleted.count || 0),
        ledgers: Number(ledgersDeleted.count || 0),
        generations: generationsDeleted.generations,
        generationOutputMediaIds: generationsDeleted.generationOutputMediaIds,
      };
    });
    deletedLogs += databaseDeletion.logs;
    deletedLedgers += databaseDeletion.ledgers;
    deletedGenerations += databaseDeletion.generations;

    if (deletableRefs.length > 0) {
      try {
        const deletion = await deleteStoredMediaRefs(deletableRefs, {
          canonicalGenerationOutputs: true,
          canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
        });
        await enqueueMediaCleanupRetryIfNeeded(deletableRefs, deletion, {
          source: "admin_storage_cleanup",
          generationIds: ids,
          canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
        });
        deletedLocalFiles += Number(deletion.deletedLocalFiles || 0);
        deletedOssObjects += Number(deletion.deletedOssObjects || 0);
        skippedProtectedRefs += Number(deletion.skippedProtectedRefsCount || 0);
        if (deletion.ossError) ossErrorCount += 1;
        deletedFiles += Number(deletion.deletedOssObjects || 0) + Number(deletion.deletedLocalFiles || 0);
      } catch (error) {
        ossErrorCount += 1;
        await enqueueMediaCleanupRetry(deletableRefs, {
          source: "admin_storage_cleanup",
          generationIds: ids,
          canonicalGenerationMediaIds: databaseDeletion.generationOutputMediaIds,
          error: String((error as Error)?.message || error),
        }).catch(() => null);
      }
      for (const [disk, size] of diskSizesToReport) {
        const stillExists = await fs.pathExists(disk).catch(() => true);
        if (!stillExists) deletedBytes += size;
      }
    }
  }

  return {
    days: safeDays,
    cutoff: cutoff.toISOString(),
    deletedGenerations,
    deletedLogs,
    deletedLedgers,
    deletedFiles,
    deletedLocalFiles,
    deletedOssObjects,
    deletedBytes,
    skippedSharedRefs,
    skippedProtectedRefs,
    ossErrorCount
  };
}

export async function GET(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);
  const { searchParams } = new URL(req.url);
  const forceRefresh = ["1", "true", "yes"].includes(String(searchParams.get("force") || "").trim().toLowerCase());
  const daysRaw = Number(searchParams.get("days") || 30);
  const analyticsDays = Number.isFinite(daysRaw) ? Math.min(90, Math.max(7, Math.floor(daysRaw))) : 30;

  const localStorageOnly = String(process.env.MEDIA_STORAGE_DRIVER || "local").trim().toLowerCase() === "local";
  const ossEnabled = !localStorageOnly && await isOssReady();

  // 读后台 cron 维护的存储快照；缓存缺失时才落到实时扫描兜底。
  const storageSnapshot = await getStorageSnapshotOrScan(forceRefresh);
  const uploadsRoot = storageSnapshot.uploadsRoot;
  const categoryStats: StorageCategory[] = storageSnapshot.categories;
  const uploadsTree = Array.isArray(storageSnapshot.uploadsTree) ? storageSnapshot.uploadsTree : [];
  const totalBytes = storageSnapshot.totalBytes;
  const totalFiles = storageSnapshot.totalFiles;

  const limits = await storageLimitsInfo();
  const safeTotalGB = limits.totalStorageGB;
  const totalLimitBytes = Math.floor(safeTotalGB * 1024 * 1024 * 1024);
  const desktopMode = isDesktopMode();
  const disk = desktopMode ? await statfs(uploadsRoot).catch(() => null) : null;
  const diskTotalBytes = disk && disk.blocks > 0 ? disk.blocks * disk.bsize : null;
  const freeBytes = desktopMode
    ? (disk ? disk.bavail * disk.bsize : 0)
    : Math.max(0, totalLimitBytes - totalBytes);
  const usedPercent = desktopMode
    ? (diskTotalBytes ? Math.max(0, 1 - freeBytes / diskTotalBytes) * 100 : 0)
    : (totalLimitBytes > 0 ? (totalBytes / totalLimitBytes) * 100 : 0);
  const warnPercent = limits.warnPercent;
  const criticalPercent = limits.criticalPercent;
  const level = levelByPercent(usedPercent, warnPercent, criticalPercent);
  const storageAlert = level === "normal" ? null : {
    level,
    title: level === "critical"
      ? (desktopMode ? "磁盘使用率已达紧急阈值" : "存储已达紧急阈值")
      : (desktopMode ? "磁盘空间不足" : "存储接近上限"),
    detail: level === "critical"
      ? `当前使用率 ${usedPercent.toFixed(1)}%，超过紧急阈值 ${criticalPercent}%`
      : `当前使用率 ${usedPercent.toFixed(1)}%，已超过预警阈值 ${warnPercent}%`,
    actionLabel: !desktopMode && level === "critical" ? "前往容量配置" : "查看清理策略",
    actionTarget: !desktopMode && level === "critical" ? "overview-storage-limits" : "overview-storage-cleanup",
  } as const;

  if (await isAdminSummaryReadModelReady()) {
    const [{ analytics, topUsers }, retention] = await Promise.all([
      loadAdminStorageReadModel(totalBytes, 90),
      retentionInfo(),
    ]);
    return NextResponse.json({
      success: true,
      uploadsRoot,
      uploadsTree,
      storageScopeLabel: "本地 uploads",
      _cache: { storageSnapshotAt: storageSnapshot.scannedAt },
      storageScopeNote: "当前按本地 uploads 目录统计容量与文件数。",
      level,
      usedPercent: Number(usedPercent.toFixed(2)),
      warnPercent,
      criticalPercent,
      totalStorageGB: safeTotalGB,
      totalLimitBytes,
      usedBytes: totalBytes,
      freeBytes,
      ...(desktopMode ? { diskTotalBytes } : {}),
      totalFiles,
      retentionDays: retention.retentionDays,
      lastPrunedAt: retention.lastPrunedAt,
      categories: categoryStats
        .sort((a, b) => b.bytes - a.bytes)
        .map((item) => enrichStorageCategory(item, uploadsRoot)),
      topUsers,
      analytics: desktopMode && storageAlert ? {
        ...analytics,
        behavior: { ...analytics.behavior, alertItems: [storageAlert, ...analytics.behavior.alertItems] },
      } : analytics,
    }, { headers: ADMIN_CACHE_HEADERS });
  }

  // 一次拉用户摘要，topUsers 和后续聚合共用同一份数据(以前调用了两次)
  const userSummaries = await listAdminUserSummaries();
  const topUsers = [...userSummaries]
    .sort((a, b) => b.generationCount - a.generationCount)
    .slice(0, 8);
  const authUsers = await prisma.user.findMany({
    select: { id: true, username: true }
  }).catch(() => []);
  const authUsernameById = new Map(authUsers.map((user) => [user.id, String(user.username || "").trim()] as const));
  const authAdminKeyByUserIdText = new Map(authUsers.map((user) => [String(user.id), `auth:${user.id}`] as const));
  const summaryByAdminKey = new Map(userSummaries.map((item) => [item.adminKey, item] as const));
  const authAdminKeyById = new Map<number, string>();
  const linkedUserAdminKey = new Map<string, string>();
  for (const user of authUsers) {
    authAdminKeyById.set(user.id, `auth:${user.id}`);
  }
  for (const item of userSummaries) {
    if (typeof item.authUserId === "number") authAdminKeyById.set(item.authUserId, item.adminKey);
    for (const linkedUserId of item.linkedUserIds || []) {
      if (typeof item.authUserId === "number") linkedUserAdminKey.set(String(linkedUserId || ""), item.adminKey);
      if (!linkedUserAdminKey.has(String(linkedUserId || ""))) linkedUserAdminKey.set(String(linkedUserId || ""), item.adminKey);
    }
  }

  // 把 Generation 扫描范围限制在最近 90 天内（analytics 面板默认看 30 天，留点余量）。
  // 大盘"全期产出/失败率"等口径直接从 AnalyticsDailyByUser 滚动表读，不再每次都扫全表。
  const GENERATION_LOOKBACK_DAYS = 90;
  const generationLookbackStart = new Date();
  generationLookbackStart.setHours(0, 0, 0, 0);
  generationLookbackStart.setDate(generationLookbackStart.getDate() - (GENERATION_LOOKBACK_DAYS - 1));
  const generationRows = await prisma.generation.findMany({
    where: { createdAt: { gte: generationLookbackStart } },
    select: {
      userId: true,
      authUserId: true,
      type: true,
      status: true,
      model: true,
      errorMsg: true,
      localPath: true,
      createdAt: true,
      sizeBytes: true,
    }
  }).catch(() => []);
  const metricsByAdminKey = new Map<
    string,
    {
      generationCount: number;
      successCount: number;
      failedCount: number;
      storageBytes: number;
      unknownStorageCount: number;
      lastCreatedAt: string | null;
      typeBreakdown: Record<AnalyticsTypeKey, number>;
      daily7: Map<string, number>;
      daily30: Map<string, number>;
      modelCounts: Map<string, number>;
      materialCount: number;
    }
  >();
  const days7 = createLastNDaysKeys(7);
  const days30 = createLastNDaysKeys(30);
  const daySet7 = new Set(days7);
  const daySet30 = new Set(days30);
  const globalDaily30 = new Map<string, { generationCount: number; storageBytes: number }>();
  for (const key of days30) globalDaily30.set(key, { generationCount: 0, storageBytes: 0 });
  const globalTypeStats: Record<AnalyticsTypeKey, { generationCount: number; storageBytes: number }> = {
    image: { generationCount: 0, storageBytes: 0 },
    video: { generationCount: 0, storageBytes: 0 },
    face: { generationCount: 0, storageBytes: 0 },
    other: { generationCount: 0, storageBytes: 0 }
  };
  const globalModelCounts = new Map<string, number>();
  const globalModelOutcome = new Map<string, { total: number; success: number; failed: number }>();
  const modelDaily = new Map<string, Map<string, number>>();
  const materialTypeStats: Record<AnalyticsTypeKey, { count: number; bytes: number }> = {
    image: { count: 0, bytes: 0 },
    video: { count: 0, bytes: 0 },
    face: { count: 0, bytes: 0 },
    other: { count: 0, bytes: 0 }
  };

  const ensureMetrics = (adminKey: string) => {
    const existing = metricsByAdminKey.get(adminKey);
    if (existing) return existing;
    const created = {
      generationCount: 0,
      successCount: 0,
      failedCount: 0,
      storageBytes: 0,
      unknownStorageCount: 0,
      lastCreatedAt: null as string | null,
      typeBreakdown: emptyTypeBreakdown(),
      daily7: new Map<string, number>(),
      daily30: new Map<string, number>(),
      modelCounts: new Map<string, number>(),
      materialCount: 0
    };
    metricsByAdminKey.set(adminKey, created);
    return created;
  };

  for (const row of generationRows) {
    // 上传素材会写一条 type="import" 的 Generation 记录占位，不算用户"产出"，
    // 否则会让"总产出素材 / 累计产出"虚高（漏斗逻辑下面已有同款过滤）
    if (String(row.type || "").toLowerCase() === "import") continue;
    const authId = typeof row.authUserId === "number" ? row.authUserId : null;
    const uid = String(row.userId || "");
    const adminKey =
      authId != null
        ? authAdminKeyById.get(authId) || `auth:${authId}`
        : linkedUserAdminKey.get(uid) || authAdminKeyByUserIdText.get(uid) || `guest:${uid}`;
    const metrics = ensureMetrics(adminKey);
    metrics.generationCount += 1;
    const status = String(row.status || "").toLowerCase();
    if (status === "success") metrics.successCount += 1;
    if (status === "failed") metrics.failedCount += 1;

    const createdAtIso = new Date(row.createdAt).toISOString();
    if (!metrics.lastCreatedAt || createdAtIso > metrics.lastCreatedAt) metrics.lastCreatedAt = createdAtIso;

    const day = dayKeyLocal(row.createdAt);
    if (daySet7.has(day)) metrics.daily7.set(day, (metrics.daily7.get(day) || 0) + 1);
    if (daySet30.has(day)) metrics.daily30.set(day, (metrics.daily30.get(day) || 0) + 1);
    const gDay = globalDaily30.get(day);
    if (gDay) gDay.generationCount += 1;

    const typeKey = analyticsTypeByGenerationType(row.type || "");
    metrics.typeBreakdown[typeKey] += 1;
    globalTypeStats[typeKey].generationCount += 1;

    const rawPath = String(row.localPath || "").trim();
    const normalizedLocalPath = normalizeUploadPath(rawPath);
    // 用 Generation.sizeBytes 字段(写入时填充),完全省掉 OSS HEAD 探测。
    const bytes = Math.max(0, Number(row.sizeBytes || 0));
    if (normalizedLocalPath) {
      metrics.materialCount += 1;
      materialTypeStats[typeKey].count += 1;
      if (!bytes) metrics.unknownStorageCount += 1;
    }
    if (bytes > 0) {
      metrics.storageBytes += bytes;
      globalTypeStats[typeKey].storageBytes += bytes;
      materialTypeStats[typeKey].bytes += bytes;
      if (gDay) gDay.storageBytes += bytes;
    }
  }

  const modelRows = await loadAdminModelUsageRows(adminStartOfDay(29));
  for (const row of modelRows) {
    const adminKey = row.authUserId != null ? `auth:${row.authUserId}` : `guest:${row.userId}`;
    const metrics = ensureMetrics(adminKey);
    const count = row.requestCount;
    metrics.modelCounts.set(row.model, (metrics.modelCounts.get(row.model) || 0) + count);
    globalModelCounts.set(row.model, (globalModelCounts.get(row.model) || 0) + count);
    const outcome = globalModelOutcome.get(row.model) || { total: 0, success: 0, failed: 0 };
    outcome.total += count;
    outcome.success += row.successCount;
    outcome.failed += row.failedCount;
    globalModelOutcome.set(row.model, outcome);
    const perDay = modelDaily.get(row.day) || new Map<string, number>();
    perDay.set(row.model, (perDay.get(row.model) || 0) + count);
    modelDaily.set(row.day, perDay);
  }

  const privateMediaStats = await prisma.mediaLibraryItem.groupBy({
    by: ["ownerUserId", "kind"],
    where: { scope: "private", isDeleted: false },
    _sum: { sizeBytes: true },
    _count: { _all: true }
  }).catch(() => []);
  for (const row of privateMediaStats) {
    const ownerUserId = typeof row.ownerUserId === "number" ? row.ownerUserId : null;
    if (ownerUserId == null) continue;
    const adminKey = authAdminKeyById.get(ownerUserId) || `auth:${ownerUserId}`;
    const metrics = ensureMetrics(adminKey);
    const rowBytes = Math.max(0, Number(row._sum?.sizeBytes || 0));
    const rowCount = Math.max(0, Number(row._count?._all || 0));
    metrics.storageBytes += rowBytes;
    metrics.materialCount += rowCount;
    const kind = String(row.kind || "").toLowerCase();
    const kindKey: AnalyticsTypeKey = kind.includes("video") ? "video" : kind.includes("image") ? "image" : "other";
    materialTypeStats[kindKey].count += rowCount;
    materialTypeStats[kindKey].bytes += rowBytes;
  }

  for (const user of authUsers) {
    ensureMetrics(`auth:${user.id}`);
  }

  const analyticsItemsDraft: AnalyticsUserItem[] = [];
  for (const [adminKey, item] of metricsByAdminKey.entries()) {
    const summary = summaryByAdminKey.get(adminKey);
    const summaryUserId = String(summary?.userId || adminKey.replace(/^auth:|^guest:/, "")).trim();
    const resolvedAuthUserId =
      summary?.authUserId ??
      (/^auth:\d+$/.test(adminKey) ? Number(adminKey.replace("auth:", "")) : null) ??
      (/^\d+$/.test(summaryUserId) ? Number(summaryUserId) : null);
    const resolvedUsernameByAuth =
      typeof resolvedAuthUserId === "number" ? String(authUsernameById.get(resolvedAuthUserId) || "").trim() : "";
    const resolvedUsernameByUserIdText = /^\d+$/.test(summaryUserId) ? "" : summaryUserId;
    const resolvedUsername =
      String(summary?.username || "").trim() || resolvedUsernameByAuth || resolvedUsernameByUserIdText;
    analyticsItemsDraft.push({
      adminKey,
      userId: summaryUserId,
      authUserId: typeof resolvedAuthUserId === "number" ? resolvedAuthUserId : null,
      username: resolvedUsername || null,
      generationCount: item.generationCount,
      successCount: item.successCount,
      failedCount: item.failedCount,
      generationShare: 0,
      storageBytes: item.storageBytes,
      storageShare: 0,
      avgBytesPerGeneration: item.generationCount > 0 ? item.storageBytes / item.generationCount : 0,
      lastCreatedAt: item.lastCreatedAt,
      typeBreakdown: item.typeBreakdown,
      trend7: days7.map((k) => item.daily7.get(k) || 0)
    });
  }

  const analyticsItems = analyticsItemsDraft;
  let allGenerations = 0;
  let allSuccess = 0;
  let allFailed = 0;
  let allStorageBytesMeasured = 0;
  let allUnknownStorageCount = 0;
  for (const item of analyticsItems) {
    allGenerations += item.generationCount;
    allSuccess += item.successCount;
    allFailed += item.failedCount;
    allStorageBytesMeasured += item.storageBytes;
    const unknownFromItem = (metricsByAdminKey.get(item.adminKey)?.unknownStorageCount || 0);
    allUnknownStorageCount += unknownFromItem;
  }
  for (const item of analyticsItems) {
    item.generationShare = allGenerations > 0 ? item.generationCount / allGenerations : 0;
    item.storageShare = allStorageBytesMeasured > 0 ? item.storageBytes / allStorageBytesMeasured : 0;
  }
  analyticsItems.sort((a, b) => {
    if (b.generationCount !== a.generationCount) return b.generationCount - a.generationCount;
    return b.storageBytes - a.storageBytes;
  });
  const activeUsers = analyticsItems.filter((x) => x.generationCount > 0).length;

  const top10Generations = analyticsItems.slice(0, 10).reduce((acc, x) => acc + x.generationCount, 0);
  const top10GenerationShare = allGenerations > 0 ? top10Generations / allGenerations : 0;
  const longTailGenerationShare = Math.max(0, 1 - top10GenerationShare);
  const efficiencyCandidates = analyticsItems
    .filter((x) => x.generationCount >= 5)
    .map((x) => ({ ...x, imbalance: x.storageShare - x.generationShare }))
    .sort((a, b) => b.imbalance - a.imbalance);
  const largestProducer = analyticsItems[0] || null;
  const largestStorageUser = [...analyticsItems].sort((a, b) => b.storageBytes - a.storageBytes)[0] || null;
  const insights: string[] = [];
  if (largestProducer && largestProducer.generationCount > 0) {
    const displayName = analyticsUserDisplayName(largestProducer.username, largestProducer.userId);
    insights.push(
      `产出最高用户为 ${displayName}，贡献 ${(
        largestProducer.generationShare * 100
      ).toFixed(1)}% 产出。`
    );
  }
  if (largestStorageUser && largestStorageUser.storageBytes > 0) {
    const displayName = analyticsUserDisplayName(largestStorageUser.username, largestStorageUser.userId);
    insights.push(
      `磁盘占用最高用户为 ${displayName}，占用户总占用 ${(
        largestStorageUser.storageShare * 100
      ).toFixed(1)}%。`
    );
  }
  if (efficiencyCandidates[0] && efficiencyCandidates[0].imbalance > 0.05) {
    const displayName = analyticsUserDisplayName(efficiencyCandidates[0].username, efficiencyCandidates[0].userId);
    insights.push(
      `${displayName} 存储占比明显高于产出占比，建议优先排查大文件和重复素材。`
    );
  }
  if (!insights.length) insights.push("当前用户产出与存储分布较均衡，可持续关注趋势变化。");

  const daily30 = days30.map((day) => {
    const row = globalDaily30.get(day) || { generationCount: 0, storageBytes: 0 };
    return { day, generationCount: row.generationCount, storageBytes: row.storageBytes };
  });
  const typeDistribution = (Object.keys(globalTypeStats) as AnalyticsTypeKey[]).map((key) => ({
    type: key,
    generationCount: globalTypeStats[key].generationCount,
    storageBytes: globalTypeStats[key].storageBytes
  }));
  const modelEntries = Array.from(globalModelCounts.entries()).map(([model, count]) => ({ model, count }));
  const totalModelCalls = modelEntries.reduce((acc, item) => acc + item.count, 0);
  const globalModelRatio = modelEntries
    .map((item) => ({
      model: item.model,
      count: item.count,
      ratio: totalModelCalls > 0 ? item.count / totalModelCalls : 0
    }))
    .sort((a, b) => b.count - a.count);
  const modelNames = globalModelRatio.map((item) => item.model);
  const modelTrend30 = days30.map((day) => {
    const perDay = modelDaily.get(day) || new Map<string, number>();
    const values: Record<string, number> = {};
    for (const model of modelNames) values[model] = perDay.get(model) || 0;
    return { day, models: values };
  });
  const modelOutcomeTop = Array.from(globalModelOutcome.entries())
    .map(([model, row]) => {
      const settled = row.success + row.failed;
      return {
        model,
        totalCalls: row.total,
        successCount: row.success,
        failedCount: row.failed,
        successRate: settled > 0 ? row.success / settled : 0,
        failedRate: settled > 0 ? row.failed / settled : 0
      };
    })
    .sort((a, b) => b.totalCalls - a.totalCalls);
  const userModelRatioTop = analyticsItems
    .map((item) => {
      const modelCounts = metricsByAdminKey.get(item.adminKey)?.modelCounts || new Map<string, number>();
      const sorted = Array.from(modelCounts.entries()).sort((a, b) => b[1] - a[1]);
      const validModelCalls = sorted.reduce((acc, [, count]) => acc + count, 0);
      const top = sorted[0] || ["未标注模型", 0];
      const breakdown = sorted.slice(0, 3).map(([model, count]) => ({
        model,
        count,
        ratio: validModelCalls > 0 ? count / validModelCalls : 0
      }));
      return {
        adminKey: item.adminKey,
        userId: item.userId,
        authUserId: item.authUserId,
        username: item.username,
        totalCalls: validModelCalls,
        topModel: top[0],
        topModelCount: top[1],
        topModelRatio: validModelCalls > 0 ? top[1] / validModelCalls : 0,
        modelBreakdown: breakdown
      };
    })
    .filter((item) => item.totalCalls > 0)
    .sort((a, b) => b.totalCalls - a.totalCalls)
    .slice(0, 12);
  const userModelMix = analyticsItems
    .map((item) => {
      const modelCounts = metricsByAdminKey.get(item.adminKey)?.modelCounts || new Map<string, number>();
      const cells: Record<string, number> = {};
      for (const [model, count] of modelCounts.entries()) {
        cells[model] = count;
      }
      return {
        adminKey: item.adminKey,
        userId: item.userId,
        authUserId: item.authUserId,
        username: item.username,
        totalCalls: Array.from(modelCounts.values()).reduce((sum, count) => sum + count, 0),
        cells
      };
    })
    .filter((item) => item.totalCalls > 0)
    .sort((a, b) => b.totalCalls - a.totalCalls)
    .slice(0, 10);
  const userMaterialTotalBytes = analyticsItems.reduce((acc, item) => acc + Math.max(0, Number(item.storageBytes || 0)), 0);
  const userMaterialTotalCount = Array.from(metricsByAdminKey.values()).reduce(
    (acc, item) => acc + Math.max(0, Number(item.materialCount || 0)),
    0
  );
  const userMaterialShareTop = analyticsItems
    .map((item) => ({
      adminKey: item.adminKey,
      userId: item.userId,
      authUserId: item.authUserId,
      username: item.username,
      bytes: item.storageBytes,
      ratio: userMaterialTotalBytes > 0 ? item.storageBytes / userMaterialTotalBytes : 0
    }))
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 12);
  const userMaterialCountShareTop = analyticsItems
    .map((item) => {
      const materialCount = Math.max(0, Number(metricsByAdminKey.get(item.adminKey)?.materialCount || 0));
      return {
        adminKey: item.adminKey,
        userId: item.userId,
        authUserId: item.authUserId,
        username: item.username,
        count: materialCount,
        ratio: userMaterialTotalCount > 0 ? materialCount / userMaterialTotalCount : 0
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);
  const materialTotalCount = (Object.keys(materialTypeStats) as AnalyticsTypeKey[]).reduce(
    (acc, key) => acc + materialTypeStats[key].count,
    0
  );
  const materialTotalBytes = (Object.keys(materialTypeStats) as AnalyticsTypeKey[]).reduce(
    (acc, key) => acc + materialTypeStats[key].bytes,
    0
  );
  const materialByTypeRatio = (Object.keys(materialTypeStats) as AnalyticsTypeKey[]).map((type) => {
    const row = materialTypeStats[type];
    return {
      type,
      count: row.count,
      countRatio: materialTotalCount > 0 ? row.count / materialTotalCount : 0,
      bytes: row.bytes,
      bytesRatio: materialTotalBytes > 0 ? row.bytes / materialTotalBytes : 0
    };
  });

  const behaviorDays = createLastNDaysKeys(analyticsDays);
  const behaviorDaySet = new Set(behaviorDays);
  const behaviorStart = new Date();
  behaviorStart.setDate(behaviorStart.getDate() - (analyticsDays - 1));
  behaviorStart.setHours(0, 0, 0, 0);
  // 不再拉 user_action.submit_generation —— 它和 generation.task_create 是同一次提交
  // 的前后端两条埋点，同时累加会让"提交数"翻倍。task_create 是后端确认任务已建，更权威。
  const behaviorLogs = await prisma.log.findMany({
    where: {
      createdAt: { gte: behaviorStart },
      OR: [
        { category: "user_action", action: { in: ["upload_input", "download_output", "delete_output", "feedback_submit"] } },
        { category: "generation", action: { in: ["task_create"] } }
      ]
    },
    select: { category: true, action: true, createdAt: true }
  }).catch(() => []);
  const behaviorFunnel = { upload: 0, submit: 0, success: 0, failed: 0, download: 0, delete: 0 };
  const dailyBehaviorMap = new Map<
    string,
    { upload: number; submit: number; success: number; failed: number; download: number; delete: number; feedbackSubmit: number }
  >();
  for (const day of behaviorDays) {
    dailyBehaviorMap.set(day, { upload: 0, submit: 0, success: 0, failed: 0, download: 0, delete: 0, feedbackSubmit: 0 });
  }
  for (const row of behaviorLogs) {
    const day = dayKeyLocal(row.createdAt);
    if (!day || !behaviorDaySet.has(day)) continue;
    const daily = dailyBehaviorMap.get(day);
    if (!daily) continue;
    if (row.category === "generation" && row.action === "task_create") {
      behaviorFunnel.submit += 1;
      daily.submit += 1;
      continue;
    }
    if (row.category !== "user_action") continue;
    if (row.action === "upload_input") {
      behaviorFunnel.upload += 1;
      daily.upload += 1;
    } else if (row.action === "download_output") {
      behaviorFunnel.download += 1;
      daily.download += 1;
    } else if (row.action === "delete_output") {
      behaviorFunnel.delete += 1;
      daily.delete += 1;
    } else if (row.action === "feedback_submit") {
      daily.feedbackSubmit += 1;
    }
  }
  const rangeGenerationRows = generationRows.filter((row) => {
    const t = new Date(row.createdAt).getTime();
    return Number.isFinite(t) && t >= behaviorStart.getTime();
  });
  for (const row of rangeGenerationRows) {
    const typeKey = analyticsTypeByGenerationType(String(row.type || ""));
    if (String(row.type || "").toLowerCase() === "import") continue;
    if (String(row.status || "").toLowerCase() === "success") behaviorFunnel.success += 1;
    if (String(row.status || "").toLowerCase() === "failed") behaviorFunnel.failed += 1;
    const day = dayKeyLocal(row.createdAt);
    if (!day || !behaviorDaySet.has(day)) continue;
    const daily = dailyBehaviorMap.get(day);
    if (!daily) continue;
    if (String(row.status || "").toLowerCase() === "success") daily.success += 1;
    if (String(row.status || "").toLowerCase() === "failed") daily.failed += 1;
    if (typeKey === "other") {
      // keep branch to mark type normalization usage
    }
  }
  const failureByTypeMap: Record<AnalyticsTypeKey, number> = { image: 0, video: 0, face: 0, other: 0 };
  const failureReasonMap = new Map<string, number>();
  for (const row of rangeGenerationRows) {
    if (String(row.status || "").toLowerCase() !== "failed") continue;
    const typeKey = analyticsTypeByGenerationType(String(row.type || ""));
    failureByTypeMap[typeKey] += 1;
    const reason = normalizeFailureReason(String(row.errorMsg || ""));
    failureReasonMap.set(reason, (failureReasonMap.get(reason) || 0) + 1);
  }
  const failureByType = (Object.keys(failureByTypeMap) as AnalyticsTypeKey[]).map((type) => ({
    type,
    count: failureByTypeMap[type]
  }));
  const failureByReasonTop = Array.from(failureReasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  const dailyBehavior30 = behaviorDays.map((day) => {
    const row = dailyBehaviorMap.get(day) || { upload: 0, submit: 0, success: 0, failed: 0, download: 0, delete: 0, feedbackSubmit: 0 };
    return { day, ...row };
  });
  const submitTotal = Math.max(1, behaviorFunnel.submit);
  const failureRate = behaviorFunnel.failed / submitTotal;
  const alertItems: Array<{ level: "info" | "warning" | "critical"; title: string; detail: string; actionLabel?: string; actionTarget?: string }> = storageAlert ? [storageAlert] : [];
  if (failureRate >= 0.2 && behaviorFunnel.failed >= 5) {
    alertItems.push({
      level: "warning",
      title: "近期开启任务失败率偏高",
      detail: `近 ${analyticsDays} 天提交 ${behaviorFunnel.submit} 次，失败 ${behaviorFunnel.failed} 次（${(failureRate * 100).toFixed(1)}%）`
    });
  }
  if (globalModelRatio[0] && globalModelRatio[0].ratio >= 0.6) {
    alertItems.push({
      level: "info",
      title: "模型调用集中度较高",
      detail: `模型 ${globalModelRatio[0].model} 调用占比 ${(globalModelRatio[0].ratio * 100).toFixed(1)}%`
    });
  }

  const retention = await retentionInfo();

  // 从 AnalyticsDailyByUser 滚动表读一份快照供新客户端使用(daily / perUser / totals)。
  // 这是 cron 维护的预聚合数据,毫秒级返回,完全不扫 Generation。
  // 当前页面 UI 继续读上面已有的 daily30 / analyticsItems 等字段;此项是新增辅助载荷,
  // 后续 UI 切到读它就行,不破坏兼容。
  const rollup = await readRollupForLastNDays(Math.max(7, Math.min(30, analyticsDays))).catch(() => null);

  return NextResponse.json({
    success: true,
    uploadsRoot,
    uploadsTree,
    storageScopeLabel: "本地 uploads",
    _cache: { storageSnapshotAt: storageSnapshot.scannedAt },
    storageScopeNote: "当前按本地 uploads 目录统计容量与文件数。",
    level,
    usedPercent: Number(usedPercent.toFixed(2)),
    warnPercent,
    criticalPercent,
    totalStorageGB: safeTotalGB,
    totalLimitBytes,
    usedBytes: totalBytes,
    freeBytes,
    ...(desktopMode ? { diskTotalBytes } : {}),
    totalFiles,
    retentionDays: retention.retentionDays,
    lastPrunedAt: retention.lastPrunedAt,
    categories: categoryStats.sort((a, b) => b.bytes - a.bytes).map((item) => enrichStorageCategory(item, uploadsRoot)),
    topUsers,
    analytics: {
      totals: {
        totalUsers: analyticsItems.length,
        activeUsers,
        totalGenerations: allGenerations,
        successGenerations: allSuccess,
        failedGenerations: allFailed,
        successRate: allGenerations > 0 ? allSuccess / allGenerations : 0,
        avgGenerationPerActiveUser: activeUsers > 0 ? allGenerations / activeUsers : 0,
        top10GenerationShare,
        longTailGenerationShare,
        totalUserStorageBytes: allStorageBytesMeasured,
        unknownStorageCount: allUnknownStorageCount
      },
      users: analyticsItems,
      daily30,
      typeDistribution,
      insights,
      behavior: {
        days: analyticsDays,
        funnel: behaviorFunnel,
        dailyBehavior30,
        failureByType,
        failureByReasonTop,
        alertItems
      },
      modelUsage: {
        globalModelRatio,
        modelOutcomeTop,
        modelTrend30,
        userModelRatioTop,
        userModelMix
      },
      userMaterialRatio: {
        userMaterialShareTop,
        userMaterialCountShareTop,
        materialByTypeRatio
      },
      // 后台 cron 维护的预聚合 (AnalyticsDailyByUser) ── 毫秒级返回,新 UI 可直接用
      rollup: rollup
        ? {
            generatedAt: new Date().toISOString(),
            daily: rollup.daily,
            totals: rollup.totals,
            perUser: rollup.perUser.map((u) => ({
              authUserId: u.authUserId,
              userId: u.userId,
              generationCount: u.generationCount,
              successCount: u.successCount,
              failedCount: u.failedCount,
              storageBytes: u.storageBytes,
              typeBreakdown: {
                image: u.imageCount,
                video: u.videoCount,
                face: u.faceCount,
                other: u.otherCount
              }
            }))
          }
        : null
    }
  }, { headers: ADMIN_CACHE_HEADERS });
}

export async function POST(req: NextRequest) {
  const auth = requireAdminRequest(req);
  if (!auth.ok) return bad(auth.error, 401);
  const body = (await req.json().catch(() => null)) as any;
  const action = String(body?.action || "").trim();

  if (action === "cleanup_temp") {
    const days = Number(body?.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return bad("请先设置 1-365 天的保留期限");
    }
    const uploadsRoot = getUploadsRootDir();
    const tempRoot = path.join(uploadsRoot, "temp");
    const result = await cleanupOlderThan(tempRoot, days);
    return NextResponse.json({ success: true, action, days, ...result });
  }

  if (action === "cleanup_old_uploads") {
    const adminPassword = String(body?.adminPassword || "").trim();
    const expectedAdminPassword = String(process.env.ADMIN_PASSWORD || "").trim();
    if (!expectedAdminPassword || adminPassword !== expectedAdminPassword) {
      return bad("管理员密码错误，请重新输入", 401);
    }
    const days = Number(body?.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return bad("请先设置 1-365 天的保留期限");
    }
    const stats = await cleanupGenerationsWithFilesOlderThan(days);
    return NextResponse.json({ success: true, action, ...stats });
  }

  if (action === "cleanup_thumbnail_assets") {
    const adminPassword = String(body?.adminPassword || "").trim();
    const expectedAdminPassword = String(process.env.ADMIN_PASSWORD || "").trim();
    if (!expectedAdminPassword || adminPassword !== expectedAdminPassword) {
      return bad("管理员密码错误，请重新输入", 401);
    }
    const days = Number(body?.days);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return bad("请先设置 1-365 天的保留期限");
    }
    const result = await cleanupStoredThumbnailAssets({
      uploadsRoot: getUploadsRootDir(),
      olderThanDays: days,
    });
    return NextResponse.json({ success: true, action, ...result });
  }

  // 清理 /api/thumb 生成的缩略图缓存。默认 30 天没访问就清掉,
  // 浏览器永久缓存命中时不影响,Cache miss 触发的请求会重新生成。
  if (action === "cleanup_thumbs") {
    const days = parsePositiveInt(body?.days, 30, 1, 365);
    const uploadsRoot = getUploadsRootDir();
    const thumbRoot = path.join(uploadsRoot, "_thumbs");
    const result = await cleanupOlderThan(thumbRoot, days);
    return NextResponse.json({ success: true, action, days, ...result });
  }

  if (action === "update_limits") {
    const totalStorageGB = Number(body?.totalStorageGB);
    const warnPercentRaw = Number(body?.warnPercent);
    const criticalPercentRaw = Number(body?.criticalPercent);
    if (!Number.isFinite(totalStorageGB) || totalStorageGB <= 0 || totalStorageGB > 10240) {
      return bad("总容量需在 0-10240 GB 之间");
    }
    if (!Number.isFinite(warnPercentRaw) || warnPercentRaw < 1 || warnPercentRaw > 99) {
      return bad("预警阈值需在 1-99 之间");
    }
    if (!Number.isFinite(criticalPercentRaw) || criticalPercentRaw <= warnPercentRaw || criticalPercentRaw > 100) {
      return bad("紧急阈值需大于预警阈值，且不超过 100");
    }
    await writeSetting(KEY_STORAGE_TOTAL_GB, String(totalStorageGB));
    await writeSetting(KEY_STORAGE_WARN_PERCENT, String(Math.floor(warnPercentRaw)));
    await writeSetting(KEY_STORAGE_CRITICAL_PERCENT, String(Math.floor(criticalPercentRaw)));
    return NextResponse.json({
      success: true,
      action,
      totalStorageGB,
      warnPercent: Math.floor(warnPercentRaw),
      criticalPercent: Math.floor(criticalPercentRaw)
    });
  }

  return bad("不支持的操作");
}
