import fs from "fs-extra";
import path from "path";
import { Prisma } from "@prisma/client";
import { deleteOssObjects, extractOssObjectKeyFromUrl, isOssReady } from "@/lib/oss";
import prisma from "@/lib/prisma";
import { resolvePublicPath } from "@/lib/public-path";
import { PROTECTED_OSS_ROOTS, PROTECTED_UPLOAD_ROOTS } from "@/lib/upload-buckets";
import { materialAssetAllMediaRefs } from "@/lib/material-asset-media";
import { isToolMediaLocalPath } from "@/lib/tool-media/lifecycle";
import { getThumbnailCachePathsForSource } from "@/lib/thumbnail-cache";

const GENERATION_DISPLAY_ASSET_KEYS = [
  "outputThumbUrl",
  "outputPreviewUrl",
  "outputPosterUrl",
  "outputDisplayUrl",
] as const;

function parseJsonObject(raw: unknown): Record<string, unknown> | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function isOwnedGenerationDisplayRef(raw: unknown) {
  const comparable = normalizeComparableMediaRef(raw);
  return comparable.startsWith("/uploads/generation_previews/")
    || comparable.startsWith("/uploads/generation_posters/");
}

export function collectOwnedGenerationMediaRefs(input: {
  localPath?: string | null;
  templateData?: unknown;
}) {
  const refs = new Set<string>();
  const localPath = normalizeComparableMediaRef(input.localPath);
  if (localPath) refs.add(localPath);
  const templateData = parseJsonObject(input.templateData);
  for (const key of GENERATION_DISPLAY_ASSET_KEYS) {
    const value = templateData?.[key];
    if (!isOwnedGenerationDisplayRef(value)) continue;
    refs.add(normalizeComparableMediaRef(value));
  }
  return Array.from(refs);
}

function normalizeUploadPath(raw: unknown) {
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

function toDiskPath(uploadPath: unknown) {
  const safe = normalizeUploadPath(uploadPath);
  if (!safe) return "";
  const rel = safe.replace(/^\/uploads\//, "");
  const configuredRoot = String(process.env.UPLOADS_DIR || "").trim();
  const uploadRoot = path.resolve(configuredRoot || resolvePublicPath("uploads"));
  const abs = path.resolve(uploadRoot, rel);
  const relative = path.relative(uploadRoot, abs);
  if (!relative || relative === ".") return "";
  if (relative.startsWith("..") || path.isAbsolute(relative)) return "";
  return abs;
}

export function collectMediaRefs(value: unknown, out: Set<string>) {
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return;
    if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === "object") {
          const parsedRefs = new Set<string>();
          collectMediaRefs(parsed, parsedRefs);
          for (const ref of parsedRefs) {
            if (/^(?:https?:\/\/|\/?uploads\/)/i.test(ref)) out.add(ref);
          }
          return;
        }
      } catch {}
    }
    // Legacy retry records can contain a path followed by a serialized JSON tail.
    // Extract its individual refs below; the entire fragment is not a file/key.
    if (!text.includes('"')) out.add(text);
    const uploadMatches = text.matchAll(/(?:^|[\s"'(])((?:\/)?uploads\/[^\s"'\\)]+)/g);
    for (const m of uploadMatches) {
      const v = String(m[1] || "").trim();
      if (v) out.add(v);
    }
    const urlMatches = text.match(/https?:\/\/[^\s"'\\]+/g) || [];
    for (const m of urlMatches) out.add(m);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectMediaRefs(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const item of Object.values(value as Record<string, unknown>)) {
      collectMediaRefs(item, out);
    }
  }
}

function isProtectedMaterialUploadPath(uploadPath: string) {
  const normalized = normalizeUploadPath(uploadPath);
  return PROTECTED_UPLOAD_ROOTS.some((root) => normalized.startsWith(root));
}

function isProtectedMaterialObjectKey(objectKey: string) {
  const key = String(objectKey || "").trim().replace(/^\/+/, "");
  return PROTECTED_OSS_ROOTS.some((root) => key.startsWith(root));
}

export function normalizeComparableMediaRef(raw: unknown) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const uploadPath = normalizeUploadPath(text);
  if (uploadPath) return uploadPath;
  try {
    const parsed = new URL(text);
    parsed.hash = "";
    parsed.searchParams.delete("x-oss-process");
    return parsed.toString();
  } catch {
    return text;
  }
}

async function loadProtectedMediaLibraryIndex(options?: { excludeMediaLibraryItemIds?: number[] }) {
  const excludeIds = Array.isArray(options?.excludeMediaLibraryItemIds)
    ? Array.from(new Set(options!.excludeMediaLibraryItemIds.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0)))
    : [];
  const where: any = { isDeleted: false };
  if (excludeIds.length) {
    where.id = { notIn: excludeIds };
  }
  const rows = await prisma.mediaLibraryItem.findMany({
    where,
    select: { fileUrl: true, thumbnailUrl: true },
  });
  const protectedComparableRefs = new Set<string>();
  const protectedObjectKeys = new Set<string>();
  for (const row of rows || []) {
    for (const value of [row.fileUrl, row.thumbnailUrl]) {
      const comparable = normalizeComparableMediaRef(value);
      if (comparable) protectedComparableRefs.add(comparable);
      const objectKey = extractOssObjectKeyFromUrl(value);
      if (objectKey) protectedObjectKeys.add(objectKey);
    }
  }
  return { protectedComparableRefs, protectedObjectKeys };
}

async function loadProtectedMaterialAssetIndex(options?: { excludeMaterialAssetIds?: number[] }) {
  const excludeIds = Array.isArray(options?.excludeMaterialAssetIds)
    ? Array.from(new Set(options!.excludeMaterialAssetIds.map((id) => Math.floor(Number(id))).filter((id) => Number.isFinite(id) && id > 0)))
    : [];
  const where: any = { isDeleted: false };
  if (excludeIds.length) {
    where.id = { notIn: excludeIds };
  }
  const rows = await prisma.materialAsset.findMany({
    where,
    select: { imageUrl: true, thumbnailUrl: true, previewUrl: true, media: true },
  });
  const protectedComparableRefs = new Set<string>();
  const protectedObjectKeys = new Set<string>();
  for (const row of rows || []) {
    for (const value of materialAssetAllMediaRefs(row)) {
      const comparable = normalizeComparableMediaRef(value);
      if (comparable) protectedComparableRefs.add(comparable);
      const objectKey = extractOssObjectKeyFromUrl(value);
      if (objectKey) protectedObjectKeys.add(objectKey);
    }
  }
  return { protectedComparableRefs, protectedObjectKeys };
}

async function loadProtectedCanvasIndex() {
  const [legacyRows, projectionRows] = await Promise.all([
    prisma.canvas.findMany({ where: { projectionRevision: BigInt(0) }, select: { data: true } }),
    prisma.canvasNodeState.findMany({ select: { data: true } }),
  ]);
  const refs = new Set<string>();
  for (const row of legacyRows) collectMediaRefs(row.data, refs);
  for (const row of projectionRows) collectMediaRefs(row.data, refs);
  const protectedComparableRefs = new Set<string>();
  for (const ref of refs) {
    const comparable = normalizeComparableMediaRef(ref);
    if (comparable) protectedComparableRefs.add(comparable);
  }
  return protectedComparableRefs;
}

async function loadProtectedCanvasUndoHoldIndex() {
  const rows = await prisma.$queryRaw<Array<{ publicRef: string | null }>>(Prisma.sql`
    SELECT "publicRef"
    FROM "CanvasUndoMediaHold"
    WHERE "expiresAt" > CURRENT_TIMESTAMP
      AND "publicRef" IS NOT NULL
  `);
  const refs = new Set<string>();
  for (const row of rows) {
    const comparable = normalizeComparableMediaRef(row.publicRef);
    if (comparable) refs.add(comparable);
  }
  return refs;
}

async function loadProtectedCanonicalOutputRefs(
  refs: ReadonlySet<string>,
  mediaIds: readonly string[] = [],
) {
  const candidates = Array.from(refs);
  if (!candidates.length || !mediaIds.length) return new Set<string>();
  const assets = await prisma.mediaAsset.findMany({
    where: {
      status: { not: "purged" },
      id: { in: [...mediaIds] },
    },
    select: {
      originalKey: true,
      publicUrl: true,
      references: { select: { id: true }, take: 1 },
      runOutputs: { select: { id: true }, take: 1 },
      generationInputs: { select: { id: true }, take: 1 },
      batchMedia: { select: { id: true }, take: 1 },
      liveVideoBatchItems: { select: { id: true }, take: 1 },
      workspaceDraftMedia: { select: { id: true }, take: 1 },
    },
  }) as Array<{
    originalKey: string | null;
    publicUrl: string | null;
    references: Array<{ id: bigint }>;
    runOutputs: Array<{ id: bigint }>;
    generationInputs: Array<{ id: bigint }>;
    batchMedia: Array<{ id: bigint }>;
    liveVideoBatchItems: Array<{ id: string }>;
    workspaceDraftMedia: Array<{ id: bigint }>;
  }>;
  const protectedRefs = new Set<string>();
  for (const asset of assets) {
    const referenced = asset.references.length > 0
      || asset.runOutputs.length > 0
      || asset.generationInputs.length > 0
      || asset.batchMedia.length > 0
      || asset.liveVideoBatchItems.length > 0
      || asset.workspaceDraftMedia.length > 0;
    if (!referenced) continue;
    for (const value of [asset.originalKey, asset.publicUrl]) {
      const comparable = normalizeComparableMediaRef(value);
      if (comparable) protectedRefs.add(comparable);
    }
  }
  return protectedRefs;
}

export async function deleteStoredMediaRefs(
  refs: Array<unknown>,
  options?: {
    excludeMediaLibraryItemIds?: number[];
    excludeMaterialAssetIds?: number[];
    allowMaterialDeletion?: boolean;
    /** Delete only the local /uploads file; never interpret it as an OSS object key. */
    localOnly?: boolean;
    /**
     * 最后防线：删除时会扫全表 generation 引用作为"保护集"，凡是被某条 generation 仍引用的资源都不会被删除。
     * 当调用方确实要删除某些 generation 自身的资源时，必须把这些 generation 的 id 传进来，
     * 让它们的引用不进入保护集，这些资源才能被删除。
     *
     * - 不传：默认保护所有 generation 的引用 → safer-by-default
     * - 传空数组：与不传等价
     */
    excludeGenerationIds?: number[];
    /**
     * 上游已完成跨 generation 引用扫描时传入，避免同一次删除再扫全表。
     * 未传时仍保持 safer-by-default，由本函数自行扫描。
     */
    protectedGenerationComparableRefs?: ReadonlySet<string>;
    /** Candidate refs are Generation.localPath outputs; use indexed MediaAsset
     * relations instead of scanning every library and canvas JSON row. */
    canonicalGenerationOutputs?: boolean;
    canonicalGenerationMediaIds?: string[];
  }
) {
  const refSet = new Set<string>();
  for (const ref of refs) {
    collectMediaRefs(ref, refSet);
  }
  // 保护索引查询必须 fail-closed：查询失败时停止物理删除，
  // 不能把“无法确认是否被引用”当成“没有被引用”。
  const canonicalGenerationOutputs = options?.canonicalGenerationOutputs === true;
  const [protectedIndex, protectedMaterialIndex, protectedCanvasComparableRefs, protectedCanvasUndoHoldRefs, protectedCanonicalOutputRefs] = canonicalGenerationOutputs
    ? await Promise.all([
        Promise.resolve({ protectedComparableRefs: new Set<string>(), protectedObjectKeys: new Set<string>() }),
        Promise.resolve({ protectedComparableRefs: new Set<string>(), protectedObjectKeys: new Set<string>() }),
        Promise.resolve(new Set<string>()),
        Promise.resolve(new Set<string>()),
        loadProtectedCanonicalOutputRefs(refSet, options?.canonicalGenerationMediaIds),
      ])
    : await Promise.all([
        loadProtectedMediaLibraryIndex(options),
        loadProtectedMaterialAssetIndex(options),
        loadProtectedCanvasIndex(),
        loadProtectedCanvasUndoHoldIndex(),
        Promise.resolve(new Set<string>()),
      ]);

  // 最后防线：把所有 generation 引用（除调用方明示的 excludeGenerationIds 外）视为受保护资源。
  // 这样即使上游调用忘记做跨记录引用检查，也绝不会误删任何被某条 generation 引用的 OSS / 本地资源。
  const suppliedProtectedGenerationRefs = options?.protectedGenerationComparableRefs;
  const protectedGenComparableRefs = suppliedProtectedGenerationRefs !== undefined
    ? suppliedProtectedGenerationRefs
    : await (async () => {
        const excludeIds = Array.isArray(options?.excludeGenerationIds)
          ? options!.excludeGenerationIds.filter((n) => Number.isFinite(n))
          : [];
        const activeGenWhere: any = excludeIds.length ? { id: { notIn: excludeIds } } : {};
        return collectComparableMediaRefsByGenerationWhere(activeGenWhere);
      })();

  const ossKeys = new Set<string>();
  const localDiskPaths = new Set<string>();
  const skippedProtectedRefs: string[] = [];
  for (const ref of refSet) {
    const comparableRef = normalizeComparableMediaRef(ref);
    if (comparableRef && protectedIndex.protectedComparableRefs.has(comparableRef)) {
      skippedProtectedRefs.push(String(ref));
      continue;
    }
    if (comparableRef && protectedMaterialIndex.protectedComparableRefs.has(comparableRef)) {
      skippedProtectedRefs.push(String(ref));
      continue;
    }
    if (comparableRef && protectedCanvasComparableRefs.has(comparableRef)) {
      skippedProtectedRefs.push(String(ref));
      continue;
    }
    if (comparableRef && protectedCanvasUndoHoldRefs.has(comparableRef)) {
      skippedProtectedRefs.push(String(ref));
      continue;
    }
    if (comparableRef && protectedCanonicalOutputRefs.has(comparableRef)) {
      skippedProtectedRefs.push(String(ref));
      continue;
    }
    if (comparableRef && protectedGenComparableRefs.has(comparableRef)) {
      skippedProtectedRefs.push(String(ref));
      continue;
    }
    const localSourceOnly = options?.localOnly || isToolMediaLocalPath(comparableRef || ref);
    const ossKey = localSourceOnly ? "" : extractOssObjectKeyFromUrl(ref);
    if (ossKey) {
      if ((!options?.allowMaterialDeletion && isProtectedMaterialObjectKey(ossKey)) || protectedIndex.protectedObjectKeys.has(ossKey) || protectedMaterialIndex.protectedObjectKeys.has(ossKey)) {
        skippedProtectedRefs.push(String(ref));
        continue;
      }
      ossKeys.add(ossKey);
      // 注意：不要 continue。saveBufferFile / saveRemoteFile 始终把素材落到本地 /uploads/，
      // 即使 ref 看起来像 OSS key（uploads/inspiration_assets/...），同一份资源往往也存在本地磁盘上。
      // 必须继续走 toDiskPath，把本地文件也加入待删列表，否则未配置 OSS（或文件未真正上 OSS）时本地会残留。
    }
    if (!options?.allowMaterialDeletion && isProtectedMaterialUploadPath(String(ref || ""))) {
      skippedProtectedRefs.push(String(ref));
      continue;
    }
    const diskPath = toDiskPath(ref);
    if (diskPath) {
      const exists = await fs.pathExists(diskPath).catch(() => false);
      if (exists) {
        const sourceStat = await fs.stat(diskPath).catch(() => null);
        if (sourceStat?.isFile()) {
          const uploadsRoot = path.resolve(String(process.env.UPLOADS_DIR || "").trim() || resolvePublicPath("uploads"));
          for (const thumbnailPath of getThumbnailCachePathsForSource({
            sourcePath: diskPath,
            sourceMtimeMs: sourceStat.mtimeMs,
            cacheDir: path.join(uploadsRoot, "_thumbs"),
          })) {
            localDiskPaths.add(thumbnailPath);
          }
        }
      }
      localDiskPaths.add(diskPath);
    }
  }

  let deletedOssObjects = 0;
  let deletedLocalFiles = 0;
  let ossError = "";
  const deletedOssKeys: string[] = [];
  const failedOssKeys: string[] = [];
  const failedLocalFiles: string[] = [];

  if (ossKeys.size > 0 && await isOssReady()) {
    const keys = Array.from(ossKeys);
    try {
      const result = await deleteOssObjects(keys);
      deletedOssObjects = Number(result?.count || 0);
      deletedOssKeys.push(...keys.slice(0, deletedOssObjects));
    } catch (error: any) {
      const msg = String(error?.message || "删除 OSS 文件失败");
      ossError = msg;
      const partialDeleted = Array.isArray(error?.deletedKeys) ? error.deletedKeys.map(String) : [];
      const partialFailed = Array.isArray(error?.failedKeys) ? error.failedKeys.map(String) : [];
      deletedOssObjects = partialDeleted.length;
      deletedOssKeys.push(...partialDeleted);
      failedOssKeys.push(...(partialFailed.length ? partialFailed : keys.map((key) => `${key}: ${msg}`)));
    }
  }

  const diskPaths = Array.from(localDiskPaths);
  let diskCursor = 0;
  const removeDiskWorker = async () => {
    while (diskCursor < diskPaths.length) {
      const filePath = diskPaths[diskCursor++];
      const exists = await fs.pathExists(filePath).catch(() => false);
      if (!exists) continue;
      const removed = await fs.remove(filePath).then(() => true).catch(() => false);
      if (removed) deletedLocalFiles += 1;
      else failedLocalFiles.push(filePath);
    }
  };
  await Promise.all(Array.from({ length: Math.min(16, diskPaths.length) }, () => removeDiskWorker()));

  return {
    deletedOssObjects,
    deletedLocalFiles,
    ossError,
    totalRefs: refSet.size,
    deletedOssKeys,
    failedOssKeys,
    failedLocalFiles,
    skippedProtectedRefsCount: skippedProtectedRefs.length,
    skippedProtectedRefsPreview: skippedProtectedRefs.slice(0, 30),
  };
}

/**
 * 计算一批 generation 在删除时可安全删除的媒体引用（comparable ref）。
 *
 * 关键点：会扣除"其他未被删除的 generation 仍引用的同一份资源"，因此可避免误删共享 OSS 对象 / 本地文件。
 *
 * - 输入：要删除的 generation id 列表
 * - 输出：safe-to-delete 的 comparable refs（可直接传给 `deleteStoredMediaRefs`）
 *
 * 用法示例：
 *   const deletableRefs = await computeDeletableRefsForGenerationIds(ids);
 *   await prisma.generation.deleteMany({ where: { id: { in: ids } } });
 *   await deleteStoredMediaRefs(deletableRefs);
 */
export async function computeDeletableRefsForGenerationIds(ids: number[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await prisma.generation.findMany({
    where: { id: { in: ids } },
    select: { localPath: true, templateData: true }
  });
  // Generation.localPath is the canonical output. templateData is otherwise a
  // snapshot, so only the explicit generated display fields above are treated
  // as owned derivatives; inputs and reusable media remain protected.
  const rawRefs = new Set<string>(rows.flatMap((row) => collectOwnedGenerationMediaRefs(row)));
  const targetComparableRefs = new Set<string>();
  for (const ref of rawRefs) {
    const comparable = normalizeComparableMediaRef(ref);
    if (comparable) targetComparableRefs.add(comparable);
  }
  const candidateRefs = Array.from(rawRefs);
  const otherRows = candidateRefs.length
    ? await prisma.generation.findMany({
        where: { id: { notIn: ids }, localPath: { in: candidateRefs } },
        select: { localPath: true },
      })
    : [];
  const referencedByOthers = new Set(
    otherRows
      .map((row) => normalizeComparableMediaRef(row.localPath))
      .filter(Boolean),
  );
  return Array.from(targetComparableRefs).filter((ref) => !referencedByOthers.has(ref));
}

export async function collectComparableGenerationLocalPathRefs(refs: unknown[]) {
  const candidates = Array.from(new Set(refs.map((ref) => String(ref || "").trim()).filter(Boolean)));
  if (!candidates.length) return new Set<string>();
  const rows = await prisma.generation.findMany({
    where: { localPath: { in: candidates } },
    select: { localPath: true },
  });
  return new Set(
    rows.map((row) => normalizeComparableMediaRef(row.localPath)).filter(Boolean),
  );
}

export async function collectComparableMediaRefsByGenerationWhere(generationWhere: any) {
  const rows = await prisma.generation.findMany({
    where: generationWhere as any,
    select: { id: true, localPath: true, templateData: true }
  });
  const generationIds = rows.map((row) => row.id);
  const logs: Array<{ metadata: string | null }> = [];
  for (let offset = 0; offset < generationIds.length; offset += 10_000) {
    const generationIdChunk = generationIds.slice(offset, offset + 10_000);
    const chunkLogs = await prisma.log.findMany({
      where: { generationId: { in: generationIdChunk }, metadata: { not: null } },
      select: { metadata: true }
    });
    logs.push(...chunkLogs);
  }

  const refs = new Set<string>();
  for (const row of rows) {
    collectMediaRefs(row.localPath, refs);
    collectMediaRefs(row.templateData, refs);
  }
  for (const row of logs) {
    collectMediaRefs(row.metadata, refs);
  }

  const comparableRefs = new Set<string>();
  for (const ref of refs) {
    const comparable = normalizeComparableMediaRef(ref);
    if (comparable) comparableRefs.add(comparable);
  }
  return comparableRefs;
}
