import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getUserId } from "@/lib/server-auth";
import { normalizeMediaUrl } from "@/lib/media-url";
import { pruneLogsIfNeeded } from "@/lib/log-retention";
import { getGenerationDisplayFields } from "@/lib/generation-display-assets";
import { FINALIZE_PROVIDERS, finalizeGeneration, isInProgressStatus } from "@/lib/generation/finalize";
import { buildHistoryCursorWhere, decodeHistoryCursor, splitHistoryPage } from "@/lib/history/cursor";
import { parseHistoryStatusIds } from "@/lib/history/status";
import { getSubmissionBatchMetadata } from "@/lib/history-batch-order";
import { buildHistorySourceWhere } from "@/lib/history/source-filter";

// 本接口只做轻量读：provider 查询、下载保存、去重、计费全部由后台 worker
// （lib/server-bootstrap.ts → lib/generation/finalize.ts）处理。
// 这里仅保留一个 fire-and-forget 兜底：任务长时间未被 worker 推进时补触发一次 finalize。

// 兜底触发条件：任务创建超过 90s 且超过 60s 未推进（worker 正常时轮不到这里）
const FALLBACK_MIN_AGE_MS = 90 * 1000;
const FALLBACK_STALE_MS = 60 * 1000;
const IN_PROGRESS_STATUSES = ["running", "queued", "pending", "submitted", "processing"];
// 同一记录的兜底触发节流，避免轮询风暴下重复触发（finalize 自身有 claim，双保险）
const FALLBACK_THROTTLE_MS = 30 * 1000;
const lastFallbackAtById = new Map<number, number>();

function maybeTriggerFinalizeFallback(item: any) {
  if (!item || item.localPath) return;
  const status = String(item.status || "").toLowerCase();
  // processing 说明有 finalizer 正在推进（卡死由 worker 的回收逻辑处理），不重复触发
  if (!isInProgressStatus(status) || status === "processing") return;
  const provider = String(item.externalProvider || "").toLowerCase();
  if (!FINALIZE_PROVIDERS.includes(provider as any)) return;

  const now = Date.now();
  const ageMs = now - new Date(item.createdAt).getTime();
  const staleMs = now - new Date(item.updatedAt || item.createdAt).getTime();
  if (ageMs < FALLBACK_MIN_AGE_MS || staleMs < FALLBACK_STALE_MS) return;

  const lastAt = lastFallbackAtById.get(item.id) || 0;
  if (now - lastAt < FALLBACK_THROTTLE_MS) return;
  lastFallbackAtById.set(item.id, now);
  if (lastFallbackAtById.size > 500) {
    for (const [key, value] of lastFallbackAtById) {
      if (now - value > FALLBACK_THROTTLE_MS * 4) lastFallbackAtById.delete(key);
    }
  }

  void finalizeGeneration(item.id).catch(() => null);
}

function parseMetadata(text: string | null | undefined) {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function mergeMetadataList(logs: Array<{ generationId: number | null; metadata: string | null; action: string }>) {
  const merged = new Map<number, Record<string, any>>();
  for (const log of logs) {
    if (!log.generationId) continue;
    const parsed = parseMetadata(log.metadata);
    if (!parsed) continue;
    const prev = merged.get(log.generationId) || {};
    const next = { ...prev, ...parsed };

    // `task_create.duration` 是用户请求的视频时长（秒），
    // `task_success.duration` 是任务执行耗时（毫秒）。合并历史参数时保留前者。
    if (log.action === "task_success" && Object.prototype.hasOwnProperty.call(prev, "duration")) {
      next.duration = prev.duration;
    }

    merged.set(log.generationId, next);
  }
  return merged;
}

async function loadGenerationParams(
  authUserId: number,
  items: Array<{ id: number; templateData: string | null }>
) {
  const metadataByGenerationId = new Map<number, Record<string, any> | null>();
  for (const item of items) {
    metadataByGenerationId.set(item.id, parseMetadata(item.templateData || null));
  }

  const itemIds = items.map((item) => item.id);
  if (!itemIds.length) return metadataByGenerationId;

  const [relatedLogs, relatedInputMedia] = await Promise.all([
    prisma.log.findMany({
      where: {
        userId: String(authUserId),
        generationId: { in: itemIds },
        category: "generation",
        action: { in: ["task_create", "task_success"] },
        metadata: { not: null }
      },
      orderBy: { createdAt: "asc" }
    }),
    prisma.generationInputMedia.findMany({
      where: {
        generationId: { in: itemIds },
        media: {
          ownerUserId: authUserId,
          status: "ready",
          purgedAt: null
        }
      },
      orderBy: [{ generationId: "asc" }, { position: "asc" }],
      select: {
        generationId: true,
        mediaId: true,
        position: true,
        role: true,
        media: {
          select: {
            id: true,
            kind: true,
            status: true,
            originalKey: true,
            publicUrl: true
          }
        }
      }
    })
  ]);
  const mergedMetadataByGenerationId = mergeMetadataList(relatedLogs);
  for (const item of items) {
    const prev = metadataByGenerationId.get(item.id) || null;
    const next = mergedMetadataByGenerationId.get(item.id) || null;
    metadataByGenerationId.set(item.id, prev && next ? { ...prev, ...next } : next || prev || null);
  }

  const inputMediaByGenerationId = new Map<number, Array<Record<string, unknown>>>();
  for (const input of relatedInputMedia) {
    const localPreviewUrl = normalizeMediaUrl(input.media.originalKey || input.media.publicUrl || "");
    if (!localPreviewUrl) continue;
    const entries = inputMediaByGenerationId.get(input.generationId) || [];
    entries.push({
      mediaId: input.mediaId,
      status: input.media.status,
      localPreviewUrl,
      kind: input.media.kind,
      position: input.position,
      role: input.role
    });
    inputMediaByGenerationId.set(input.generationId, entries);
  }
  for (const item of items) {
    const inputMedia = inputMediaByGenerationId.get(item.id);
    if (!inputMedia?.length) continue;
    metadataByGenerationId.set(item.id, {
      ...(metadataByGenerationId.get(item.id) || {}),
      inputMedia
    });
  }

  return metadataByGenerationId;
}

async function persistMissingTemplateData(items: Array<{ id: number; templateData: string | null }>, paramsById: Map<number, Record<string, any> | null>) {
  const updates = items
    .filter((item) => !item.templateData)
    .map((item) => {
      const params = paramsById.get(item.id);
      if (!params) return null;
      return prisma.generation.update({
        where: { id: item.id },
        data: { templateData: JSON.stringify(params) }
      });
    })
    .filter(Boolean);

  if (!updates.length) return;
  await Promise.allSettled(updates);
}

// phase / 远程预览 / 可下载 / 可复用 —— 供前端在保存完成前抢先展示与下载
function buildPhaseFields(item: any, params: Record<string, any> | null) {
  const meta = params || {};
  const remotePreviewUrls: string[] = Array.isArray(meta.remotePreviewUrls)
    ? meta.remotePreviewUrls.filter((u: any) => typeof u === "string" && /^https?:\/\//i.test(u))
    : [];
  const hasLocal = Boolean(item.localPath);
  const status = String(item.status || "").toLowerCase();
  let phase = typeof meta.phase === "string" && meta.phase ? meta.phase : "";
  if (!phase) {
    phase = hasLocal || status === "success" ? "ready" : status === "failed" ? "failed" : "generating";
  }
  return {
    phase,
    remotePreviewUrls,
    downloadable: hasLocal || remotePreviewUrls.length > 0,
    readyForReuse: hasLocal,
  };
}

function buildDisplayFields(item: any, params: Record<string, any> | null, phaseFields: ReturnType<typeof buildPhaseFields>) {
  const display = getGenerationDisplayFields({
    type: item.type,
    localPath: item.localPath || "",
    templateData: params,
  });
  // 视频保留远程预览；图片等待生成好的预览图，避免先加载原图再切换缩略图。
  if (!item.localPath && phaseFields.remotePreviewUrls.length && display.displayKind === "video") {
    const remote = phaseFields.remotePreviewUrls[0];
    if (!display.displayUrl) display.displayUrl = remote;
    if (!display.previewUrl) display.previewUrl = remote;
  }
  return display;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const authUserId = await getUserId(req)
  const take = Math.min(Math.max(Number(searchParams.get("take") || 50) || 50, 1), 1000);
  const skip = Math.max(Number(searchParams.get("skip") || 0) || 0, 0);
  const idParam = (searchParams.get("id") || "").trim();
  const statusParam = (searchParams.get("status") || "success").trim();
  const typeParam = (searchParams.get("type") || "").trim();
  const withOutputParam = (searchParams.get("withOutput") || "1").trim();
  const sourceParam = (searchParams.get("source") || "tool").trim();
  const excludeImport = searchParams.get("excludeImport") === "1";
  const viewParam = (searchParams.get("view") || "full").trim();

  if (!authUserId) return NextResponse.json({ error: apiMessage("mc1986431234d") }, { status: 401 });
  await pruneLogsIfNeeded();

  if (viewParam === "status") {
    const hasIdsParam = searchParams.has("ids");
    const ids = parseHistoryStatusIds(searchParams.get("ids"));
    if (hasIdsParam && !ids.length) return NextResponse.json({ items: [] });

    const statusFilters: any[] = [
      {
        OR: [
          { authUserId },
          { AND: [{ authUserId: null }, { userId: String(authUserId) }] },
        ],
      },
    ];
    if (ids.length) statusFilters.push({ id: { in: ids } });
    if (typeParam) statusFilters.push({ type: typeParam });
    const statusSourceWhere = buildHistorySourceWhere(sourceParam);
    if (statusSourceWhere) statusFilters.push(statusSourceWhere);
    if (statusParam === "in_progress") statusFilters.push({ status: { in: IN_PROGRESS_STATUSES } });

    const includeSubmissionBatch = !ids.length;
    const rows = await prisma.generation.findMany({
      where: { AND: statusFilters },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: ids.length ? Math.min(ids.length, 100) : statusParam === "in_progress" ? 100 : 20,
      select: {
        id: true,
        type: true,
        status: true,
        localPath: true,
        errorMsg: true,
        updatedAt: true,
        externalProvider: true,
        requestKey: true,
        createdAt: true,
        templateData: true,
      },
    });

    for (const row of rows) maybeTriggerFinalizeFallback(row);
    return NextResponse.json({
      items: rows.map((row) => {
        const createdAt = new Date(row.createdAt).toISOString();
        const params = parseMetadata((row as any).templateData || null);
        const phaseFields = buildPhaseFields(row, params);
        const display = buildDisplayFields(row, params, phaseFields);
        const batch = includeSubmissionBatch
          ? getSubmissionBatchMetadata({
              id: String(row.id),
              createdAt,
              params,
            })
          : null;
        return {
          id: row.id,
          type: row.type,
          status: row.status,
          localPath: normalizeMediaUrl(row.localPath || "") || null,
          displayUrl: normalizeMediaUrl(display.displayUrl || display.previewUrl || "") || null,
          phase: phaseFields.phase,
          errorMsg: row.errorMsg || null,
          requestKey: String((row as any).requestKey || "").trim() || null,
          ...(batch ? {
            batchId: batch.id,
            batchIndex: batch.index,
            batchSize: batch.size,
            batchSubmittedAt: batch.submittedAt,
          } : {}),
          createdAt,
          updatedAt: new Date(row.updatedAt).toISOString(),
        };
      }),
    });
  }

  if (idParam) {
    const id = Number(idParam);
    if (!Number.isFinite(id)) return NextResponse.json({ error: apiMessage("m39a179be21a4") }, { status: 400 });
    const item = await prisma.generation.findUnique({
      where: { id },
      include: { liveVideoBatchOutput: { select: { id: true } } },
    });
    if (!item) return NextResponse.json({ error: apiMessage("me4ba03868d92") }, { status: 404 });
    const itemAuthUserId = (item as any).authUserId
    if (itemAuthUserId !== authUserId) return NextResponse.json({ error: apiMessage("m2a392451ca61") }, { status: 403 });
    const itemSourceMismatch = sourceParam && sourceParam !== "all"
      && (
        String((item as any).source || "tool") !== sourceParam
        || (sourceParam === "tool" && Boolean((item as any).liveVideoBatchOutput))
      );
    if (itemSourceMismatch) {
      return NextResponse.json({ error: apiMessage("me4ba03868d92") }, { status: 404 });
    }
    const { liveVideoBatchOutput: _liveVideoBatchOutput, ...historyItem } = item as any;
    maybeTriggerFinalizeFallback(item);
    const paramsById = await loadGenerationParams(authUserId, [
      {
        id: item.id,
        templateData: (item as any).templateData || null
      }
    ]);
    await persistMissingTemplateData(
      [
        {
          id: item.id,
          templateData: (item as any).templateData || null
        }
      ],
      paramsById
    );
    const params = paramsById.get(item.id) || null;
    const phaseFields = buildPhaseFields(item, params);
    const display = buildDisplayFields(item, params, phaseFields);
    return NextResponse.json({
      item: {
        ...historyItem,
        localPath: normalizeMediaUrl((item as any).localPath || ""),
        params,
        ...phaseFields,
        ...display
      }
    });
  }

  let cursor = null;
  if (searchParams.has("cursor")) {
    try {
      cursor = decodeHistoryCursor(String(searchParams.get("cursor") || ""));
    } catch {
      return NextResponse.json({ error: apiMessage("mc6d4f039fa85") }, { status: 400 });
    }
  }

  const filters: any[] = [
    {
      OR: [
        { authUserId },
        { AND: [{ authUserId: null }, { userId: String(authUserId) }] },
      ],
    },
  ];
  if (cursor) filters.push(buildHistoryCursorWhere(cursor));
  const sourceWhere = buildHistorySourceWhere(sourceParam);
  if (sourceWhere) filters.push(sourceWhere);
  if (excludeImport) filters.push({ type: { not: "import" } });
  if (typeParam) filters.push({ type: typeParam });
  if (statusParam && statusParam !== "all") filters.push({ status: statusParam });
  if (withOutputParam !== "0") filters.push({ localPath: { not: null } });

  const listArgs: any = {
    where: { AND: filters },
    // 按创建时间排序，避免进行中任务因 finishedAt 为空被挤出当前分页，导致前端短暂出现后消失
    orderBy: [{ createdAt: "desc" }, { id: "desc" }] as any,
    take: take + 1,
  };
  if (!cursor) listArgs.skip = skip;
  const itemsPlus = await prisma.generation.findMany(listArgs);
  const page = splitHistoryPage(itemsPlus, take);
  const items = page.items;

  // 兜底：worker 长时间没推进的任务补触发一次收尾（不 await，不拖慢响应）
  for (const it of items as any[]) {
    maybeTriggerFinalizeFallback(it);
  }

  const metadataByGenerationId = await loadGenerationParams(
    authUserId,
    items.map((item) => ({
      id: item.id,
      templateData: (item as any).templateData || null
    }))
  );
  await persistMissingTemplateData(
    items.map((item) => ({
      id: item.id,
      templateData: (item as any).templateData || null
    })),
    metadataByGenerationId
  );
  return NextResponse.json({
    items: items.map((it) => {
      const params = metadataByGenerationId.get(it.id) || null;
      const phaseFields = buildPhaseFields(it, params);
      const display = buildDisplayFields(it, params, phaseFields);
      return {
        ...it,
        localPath: normalizeMediaUrl((it as any).localPath || ""),
        prompt: String((it as any).prompt || ""),
        params,
        ...phaseFields,
        ...display
      };
    }),
    hasMore: page.hasMore,
    nextCursor: page.nextCursor,
  });
}
