import { apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { normalizeMediaUrl } from "@/lib/media-url";
import { getUserId } from "@/lib/server-auth";
import { getGenerationDisplayFields } from "@/lib/generation-display-assets";
import { getUserInspirationTemplatesByGenerationIds } from "@/lib/inspiration-template-service";
import { isDesktopMode } from "@/lib/desktop-mode";
import { isAdminRequest } from "@/lib/admin-auth";
import { getCanvasAssetHistory } from "@/lib/assets/canvas-history-server";
import {
  attachAssetBatchMode,
  buildAssetSourceWhere,
  CREATION_ASSET_SOURCES,
  isAssetBatchMode,
  resolveAssetSource,
  TOOL_CANVAS_ASSET_SOURCES,
  type AssetBatchMode,
} from "@/lib/assets/source-filter";

type AssetCursor = { createdAt: string; id: number };

const DEFAULT_TAKE = 60;
const MAX_TAKE = 100;
const MAX_ADMIN_ALL_TAKE = 1000;
const SCAN_BUFFER = 20;
const MAX_SCAN_ROUNDS = 3;
const MAX_SCANNED_ROWS = 200;
const MEDIA_EXT = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".mp4", ".webm", ".mov", ".m4v", ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"];
const VIDEO_TYPES = ["video_gen", "video_generate"];
const OTHER_EXCLUDED_TYPES = ["face_swap", "image_edit", ...VIDEO_TYPES, "audio_gen", "import"];

function encodeCursor(cursor: AssetCursor | null) {
  if (!cursor) return null;
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeCursor(raw: string | null): AssetCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Partial<AssetCursor>;
    const id = Number(parsed.id);
    const createdAt = String(parsed.createdAt || "");
    if (!Number.isFinite(id) || id <= 0 || !createdAt || Number.isNaN(new Date(createdAt).getTime())) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

function rowCursor(row: { id: number; createdAt: Date | string }) {
  return { id: row.id, createdAt: new Date(row.createdAt).toISOString() };
}

function cardKey(row: { id: number; type: string | null; externalTaskId: string | null }) {
  const taskId = String(row.externalTaskId || "").trim();
  return taskId ? `${String(row.type || "")}:${taskId}` : `id:${String(row.id)}`;
}

function parseTake(raw: string | null) {
  const n = Number(raw || "");
  if (!Number.isFinite(n)) return DEFAULT_TAKE;
  return Math.min(Math.max(Math.floor(n), 1), MAX_TAKE);
}

function toPathArray(value: any) {
  if (!Array.isArray(value)) return [] as string[];
  return Array.from(new Set(value.map((x) => normalizeMediaUrl(x)).filter((url) => url && !url.startsWith("asset://"))));
}

function extractInputImages(params: Record<string, any> | null | undefined) {
  const p = params || {};
  const taskType = String(p.taskType || "").trim().toLowerCase();
  const mediaPath = normalizeMediaUrl(p.mediaPath || "");
  const inputUrl = normalizeMediaUrl(p.inputUrl || p.image_url || "");
  if (taskType === "video_gen" || taskType === "video_generate") {
    const videoInputs: string[] = [];
    const pushVideoInput = (value: any) => {
      const normalized = normalizeMediaUrl(value);
      if (normalized && !normalized.startsWith("asset://")) videoInputs.push(normalized);
    };
    if (Array.isArray(p.inputMedia)) {
      for (const item of p.inputMedia) pushVideoInput((item as any)?.url);
    }
    pushVideoInput(p.inputPreviewUrl);
    pushVideoInput(mediaPath);
    pushVideoInput(inputUrl);
    if (videoInputs.length) return Array.from(new Set(videoInputs));
  }
  const fromArray = toPathArray(p.imagePaths || p.inputImages || p.sourceImages || p.image_urls || p.output_images);
  if (fromArray.length) return fromArray;
  return toPathArray([p.facePath, p.targetPath, p.imagePath, p.sourcePath, mediaPath, inputUrl]);
}

function extractPrompt(params: Record<string, any> | null | undefined) {
  const p = params || {};
  const direct = String(p.prompt || "").trim();
  if (direct) return direct;
  const nodeInfoList = Array.isArray(p.nodeInfoList) ? p.nodeInfoList : [];
  for (const node of nodeInfoList) {
    const field = String(node?.fieldName || "").trim().toLowerCase();
    if (field !== "prompt") continue;
    const value = String(node?.fieldValue || "").trim();
    if (value) return value;
  }
  return "";
}

function parseTemplateData(raw: string | null | undefined) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, any>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function mergeMetadataList(logs: Array<{ generationId: number | null; metadata: string | null; action: string }>) {
  const merged = new Map<number, Record<string, any>>();
  for (const log of logs) {
    if (!log.generationId) continue;
    try {
      const parsed = log.metadata ? (JSON.parse(log.metadata) as Record<string, any>) : null;
      if (!parsed || typeof parsed !== "object") continue;
      const prev = merged.get(log.generationId) || {};
      const next = { ...prev, ...parsed };
      if (log.action === "task_success" && Object.prototype.hasOwnProperty.call(prev, "duration")) {
        next.duration = prev.duration;
      }
      merged.set(log.generationId, next);
    } catch {}
  }
  return merged;
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

function mergeParamsPreferFilled(
  current: Record<string, any> | null | undefined,
  incoming: Record<string, any> | null | undefined
): Record<string, any> | null {
  if (!current && !incoming) return null;
  if (!current) return incoming ? { ...incoming } : null;
  if (!incoming) return { ...current };
  const out: Record<string, any> = { ...current };
  for (const [key, nextVal] of Object.entries(incoming)) {
    const prevVal = out[key];
    if (prevVal && typeof prevVal === "object" && !Array.isArray(prevVal) && nextVal && typeof nextVal === "object" && !Array.isArray(nextVal)) {
      out[key] = mergeParamsPreferFilled(prevVal as Record<string, any>, nextVal as Record<string, any>) || prevVal;
      continue;
    }
    if (!hasMeaningfulValue(prevVal) && hasMeaningfulValue(nextVal)) out[key] = nextVal;
  }
  return out;
}

function buildBatchSourceSql(batchMode: AssetBatchMode | null) {
  if (batchMode === "live_video") {
    return Prisma.sql`EXISTS (
      SELECT 1 FROM "LiveVideoBatchOutput" AS live_output
      WHERE live_output."generationId" = "Generation"."id"
    )`;
  }
  if (batchMode === "style_replication" || batchMode === "multi_prompt") {
    return Prisma.sql`EXISTS (
      SELECT 1
      FROM "ImageBatchOutput" AS batch_output
      INNER JOIN "ImageBatch" AS image_batch ON image_batch."id" = batch_output."batchId"
      WHERE batch_output."generationId" = "Generation"."id"
        AND image_batch."mode" = ${batchMode}
    )`;
  }
  return Prisma.sql`(
    "source" = 'batch'
    OR EXISTS (
      SELECT 1 FROM "LiveVideoBatchOutput" AS live_output
      WHERE live_output."generationId" = "Generation"."id"
    )
  )`;
}

function buildAssetFilters(params: {
  authUserId: number;
  tab: string;
  q: string;
  source: string;
  batchMode: AssetBatchMode | null;
  typeFilter: string;
  days: string;
}) {
  const { authUserId, tab, q, source, batchMode, typeFilter, days } = params;
  const isImport = tab === "import";
  const sourceWhere = buildAssetSourceWhere(source, batchMode);
  const where: any = {
    AND: [
      {
        OR: [
          { authUserId },
          { AND: [{ authUserId: null }, { userId: String(authUserId) }] }
        ]
      },
      { status: "success" },
      { localPath: { not: null } },
      { NOT: { localPath: { contains: "/canvas_voice_previews/" } } },
      isImport ? { type: "import" } : { type: { not: "import" } },
      ...(sourceWhere ? [sourceWhere] : []),
      { OR: MEDIA_EXT.map((ext) => ({ localPath: { endsWith: ext } })) }
    ]
  };

  const sql: Prisma.Sql[] = [
    Prisma.sql`(("authUserId" = ${authUserId}) OR ("authUserId" IS NULL AND "userId" = ${String(authUserId)}))`,
    Prisma.sql`"status" = 'success'`,
    Prisma.sql`"localPath" IS NOT NULL`,
    Prisma.sql`"localPath" NOT LIKE ${"%/canvas_voice_previews/%"}`,
    isImport ? Prisma.sql`"type" = 'import'` : Prisma.sql`"type" <> 'import'`,
    Prisma.sql`(${Prisma.join(MEDIA_EXT.map((ext) => Prisma.sql`"localPath" LIKE ${`%${ext}`}`), " OR ")})`
  ];

  if (source === "creation") {
    sql.push(Prisma.sql`"source" IN (${Prisma.join([...CREATION_ASSET_SOURCES])})`);
  } else if (source === "tool_canvas") {
    sql.push(Prisma.sql`(
      "source" IN (${Prisma.join([...TOOL_CANVAS_ASSET_SOURCES])})
      AND NOT EXISTS (
        SELECT 1 FROM "LiveVideoBatchOutput" AS live_output
        WHERE live_output."generationId" = "Generation"."id"
      )
    )`);
  } else if (source === "batch") {
    sql.push(buildBatchSourceSql(batchMode));
  } else if (source === "tool") {
    sql.push(Prisma.sql`(
      "source" = 'tool'
      AND NOT EXISTS (
        SELECT 1 FROM "LiveVideoBatchOutput" AS live_output
        WHERE live_output."generationId" = "Generation"."id"
      )
    )`);
  } else if (source && source !== "all") {
    sql.push(Prisma.sql`"source" = ${source}`);
  }

  if (q) {
    const like = `%${q}%`;
    where.AND.push({ OR: [{ prompt: { contains: q } }, { localPath: { contains: q } }] });
    sql.push(Prisma.sql`("prompt" LIKE ${like} OR "localPath" LIKE ${like})`);
  }

  const daysNum = Number(days);
  if (Number.isFinite(daysNum) && daysNum > 0) {
    const cutoff = new Date(Date.now() - Math.floor(daysNum) * 24 * 60 * 60 * 1000);
    where.AND.push({ createdAt: { gte: cutoff } });
    sql.push(Prisma.sql`"createdAt" >= ${cutoff}`);
  }

  if (!isImport && typeFilter && typeFilter !== "all") {
    if (typeFilter === "video") {
      where.AND.push({ type: { in: VIDEO_TYPES } });
      sql.push(Prisma.sql`"type" IN (${Prisma.join(VIDEO_TYPES)})`);
    } else if (typeFilter === "audio") {
      where.AND.push({ type: "audio_gen" });
      sql.push(Prisma.sql`"type" = ${"audio_gen"}`);
    } else if (typeFilter === "image") {
      where.AND.push({ type: { in: ["image_edit", "face_swap"] } });
      sql.push(Prisma.sql`"type" IN (${Prisma.join(["image_edit", "face_swap"])})`);
    } else if (typeFilter === "other") {
      where.AND.push({ type: { notIn: OTHER_EXCLUDED_TYPES } });
      sql.push(Prisma.sql`"type" NOT IN (${Prisma.join(OTHER_EXCLUDED_TYPES)})`);
    } else if (typeFilter === "face_swap" || typeFilter === "image_edit") {
      where.AND.push({ type: typeFilter });
      sql.push(Prisma.sql`"type" = ${typeFilter}`);
    }
  }

  return {
    isImport,
    where,
    sqlWhere: Prisma.join(sql, " AND ")
  };
}

async function countAssets(sqlWhere: Prisma.Sql) {
  const rows = await prisma.$queryRaw<Array<{ total: bigint | number }>>`
    SELECT (
      COUNT(*) FILTER (WHERE NULLIF(BTRIM("externalTaskId"), '') IS NULL)
      + COUNT(DISTINCT ("type", NULLIF(BTRIM("externalTaskId"), ''))) FILTER (WHERE NULLIF(BTRIM("externalTaskId"), '') IS NOT NULL)
    )::bigint AS total
    FROM "Generation"
    WHERE ${sqlWhere}
  `;
  return Number(rows[0]?.total || 0);
}

async function hydrateRows(rows: any[], authUserId: number, isImport: boolean, cardsOnly = false) {
  const ids = rows.map((x) => x.id).filter((x) => typeof x === "number");
  const paramsById = new Map<number, Record<string, any> | null>();
  for (const row of rows) paramsById.set(row.id, parseTemplateData((row as any).templateData || null));

  if (ids.length) {
    const [logs, reusableInputMedia, batchOutputs, liveVideoBatchOutputs] = await Promise.all([
      cardsOnly ? Promise.resolve([]) : prisma.log.findMany({
        where: {
          userId: String(authUserId),
          generationId: { in: ids },
          category: "generation",
          action: { in: ["task_create", "task_success"] },
          metadata: { not: null }
        },
        orderBy: { createdAt: "asc" }
      }),
      cardsOnly ? Promise.resolve([]) : prisma.generationInputMedia.findMany({
        where: {
          generationId: { in: ids },
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
              kind: true,
              status: true,
              originalKey: true,
              publicUrl: true
            }
          }
        }
      }),
      prisma.imageBatchOutput.findMany({
        where: { generationId: { in: ids } },
        select: {
          generationId: true,
          batch: { select: { mode: true } },
        },
      }),
      prisma.liveVideoBatchOutput.findMany({
        where: { generationId: { in: ids } },
        select: { generationId: true },
      }),
    ]);
    const merged = mergeMetadataList(logs);
    for (const id of ids) {
      const prev = paramsById.get(id) ?? null;
      const next = merged.get(id) ?? null;
      paramsById.set(id, prev && next ? { ...prev, ...next } : next || prev || null);
    }
    for (const output of batchOutputs) {
      if (!output.generationId) continue;
      paramsById.set(
        output.generationId,
        attachAssetBatchMode(paramsById.get(output.generationId), output.batch.mode),
      );
    }
    for (const output of liveVideoBatchOutputs) {
      if (!output.generationId) continue;
      paramsById.set(
        output.generationId,
        attachAssetBatchMode(paramsById.get(output.generationId), "live_video"),
      );
    }

    const inputMediaByGenerationId = new Map<number, Array<Record<string, unknown>>>();
    for (const input of reusableInputMedia) {
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
    for (const id of ids) {
      const inputMedia = inputMediaByGenerationId.get(id);
      if (!inputMedia?.length) continue;
      paramsById.set(id, {
        ...(paramsById.get(id) || {}),
        inputMedia
      });
    }
  }

  const inspirationTemplateByGenerationId = isImport || cardsOnly || isDesktopMode()
    ? new Map<number, { templateId: number; sourceGenerationId: number }>()
    : await getUserInspirationTemplatesByGenerationIds(authUserId, ids);

  if (isImport) {
    return rows.map((x) => {
      const params = paramsById.get(x.id) ?? null;
      const display = getGenerationDisplayFields({
        type: (x as any).type,
        localPath: (x as any).localPath || "",
        templateData: params,
      });
      return {
        ...x,
        source: resolveAssetSource(x.source, params),
        localPath: normalizeMediaUrl(x.localPath || ""),
        params,
        inputImages: [],
        outputPaths: [normalizeMediaUrl(x.localPath || "")].filter(Boolean),
        ...display
      };
    });
  }

  const groups = new Map<string, { head: any; params: Record<string, any> | null; outputPaths: string[]; ids: number[] }>();
  for (const row of rows) {
    const key = cardKey(row);
    const existing = groups.get(key);
    const params = paramsById.get(row.id) ?? null;
    const localPath = normalizeMediaUrl(row.localPath || "");
    const lastFramePath = normalizeMediaUrl(String((params as any)?.lastFramePath || ""));
    if (!existing) {
      groups.set(key, { head: row, params, outputPaths: [localPath, lastFramePath].filter(Boolean), ids: [row.id] });
      continue;
    }
    existing.ids.push(row.id);
    if (localPath && !existing.outputPaths.includes(localPath)) existing.outputPaths.push(localPath);
    if (lastFramePath && !existing.outputPaths.includes(lastFramePath)) existing.outputPaths.push(lastFramePath);
    existing.params = mergeParamsPreferFilled(existing.params, params);
  }

  return Array.from(groups.values())
    .map((group) => {
      const outputPaths = Array.from(new Set(group.outputPaths));
      const inputImages = extractInputImages(group.params);
      const promptFromRow = String((group.head as any)?.prompt || "").trim();
      const promptFromParams = extractPrompt(group.params);
      const inspirationTemplate = group.ids
        .map((id) => inspirationTemplateByGenerationId.get(id))
        .find(Boolean);
      return {
        ...group.head,
        source: resolveAssetSource(group.head.source, group.params),
        localPath: normalizeMediaUrl((group.head as any)?.localPath || ""),
        prompt: promptFromRow || promptFromParams || null,
        params: group.params,
        inputImages: inputImages.map((p) => normalizeMediaUrl(p)).filter(Boolean),
        outputPaths,
        inspirationTemplateId: inspirationTemplate?.templateId || null,
        inspirationSourceGenerationId: inspirationTemplate?.sourceGenerationId || null,
        ...getGenerationDisplayFields({
          type: (group.head as any)?.type,
          localPath: (group.head as any)?.localPath || "",
          templateData: group.params,
        })
      };
    })
    .sort((a, b) => {
      const delta = new Date(String(b.createdAt || 0)).getTime() - new Date(String(a.createdAt || 0)).getTime();
      return delta || Number(b.id || 0) - Number(a.id || 0);
    });
}

const ASSET_CARD_SELECT = {
  id: true, type: true, source: true, status: true, prompt: true, localPath: true,
  createdAt: true, finishedAt: true, model: true, externalTaskId: true, templateData: true,
} satisfies Prisma.GenerationSelect;

function toAssetCard(item: any) {
  return {
    id: item.id, type: item.type, source: item.source, status: item.status,
    prompt: item.prompt, localPath: item.localPath, createdAt: item.createdAt,
    finishedAt: item.finishedAt, model: item.model, externalTaskId: item.externalTaskId,
    displayUrl: item.displayUrl, previewUrl: item.previewUrl, posterUrl: item.posterUrl,
    thumbUrl: item.thumbUrl, displayKind: item.displayKind, outputPaths: item.outputPaths,
    params: item.params?.batch ? { batch: { mode: item.params.batch.mode } } : {},
    detailPending: true,
  };
}

function appendRowsUntilTake(targetRows: any[], targetKeys: Set<string>, rows: any[], take: number) {
  let lastReturned: any | null = null;
  for (const row of rows) {
    const key = cardKey(row);
    if (!targetKeys.has(key) && targetKeys.size >= take) {
      return { lastReturned, stoppedByTake: true };
    }
    targetRows.push(row);
    targetKeys.add(key);
    lastReturned = row;
  }
  return { lastReturned, stoppedByTake: false };
}

async function fetchPagedRows(where: any, take: number, initialCursor: AssetCursor | null, cardsOnly = false, order: "asc" | "desc" = "desc") {
  const returnedRows: any[] = [];
  const returnedKeys = new Set<string>();
  let scanCursor = initialCursor;
  let lastReturnedRow: any | null = null;
  let scannedRows = 0;
  let reachedEnd = false;
  let stoppedByCap = false;
  let stoppedByTake = false;

  for (let round = 0; round < MAX_SCAN_ROUNDS; round++) {
    const remainingScan = MAX_SCANNED_ROWS - scannedRows;
    if (remainingScan <= 0) {
      stoppedByCap = true;
      break;
    }

    const limit = Math.min(take + SCAN_BUFFER, remainingScan);
    const rows = await prisma.generation.findMany({
      where: scanCursor ? { AND: [where, { OR: [
        { createdAt: { [order === "asc" ? "gt" : "lt"]: new Date(scanCursor.createdAt) } },
        { createdAt: new Date(scanCursor.createdAt), id: { [order === "asc" ? "gt" : "lt"]: scanCursor.id } },
      ] }] } : where,
      orderBy: [{ createdAt: order }, { id: order }],
      take: limit,
      ...(cardsOnly ? { select: ASSET_CARD_SELECT } : {}),
    });
    scannedRows += rows.length;

    if (!rows.length) {
      reachedEnd = true;
      break;
    }

    const fullWindow = rows.length === limit;
    let candidateRows = rows;
    if (fullWindow) {
      const tailKey = cardKey(rows[rows.length - 1]);
      candidateRows = rows.filter((row) => cardKey(row) !== tailKey);
    } else {
      reachedEnd = true;
    }

    if (!candidateRows.length) {
      const firstKey = cardKey(rows[0]);
      candidateRows = rows.filter((row) => cardKey(row) === firstKey);
      const appended = appendRowsUntilTake(returnedRows, returnedKeys, candidateRows, take);
      lastReturnedRow = appended.lastReturned || lastReturnedRow;
      stoppedByCap = true;
      break;
    }

    const appended = appendRowsUntilTake(returnedRows, returnedKeys, candidateRows, take);
    lastReturnedRow = appended.lastReturned || lastReturnedRow;
    scanCursor = rowCursor(candidateRows[candidateRows.length - 1]);
    stoppedByTake = appended.stoppedByTake || returnedKeys.size >= take;
    if (stoppedByTake || reachedEnd) break;
  }

  if (!reachedEnd && returnedRows.length && !stoppedByTake) stoppedByCap = true;
  const hasMore = !!returnedRows.length && (!reachedEnd || stoppedByTake || stoppedByCap);
  return {
    rows: returnedRows,
    nextCursor: hasMore && lastReturnedRow ? encodeCursor(rowCursor(lastReturnedRow)) : null,
    hasMore
  };
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  if (searchParams.get("view") === "canvas-history") return getCanvasAssetHistory(req);
  const tab = (searchParams.get("tab") || "generated").toLowerCase();
  const q = (searchParams.get("q") || "").trim();
  const all = searchParams.get("all") === "1";
  const take = parseTake(searchParams.get("take"));
  const skip = Math.max(Number(searchParams.get("skip") || 0) || 0, 0);
  const source = (searchParams.get("source") || "creation").trim();
  const batchModeRaw = String(searchParams.get("batchMode") || "").trim();
  if (source === "batch" && batchModeRaw && !isAssetBatchMode(batchModeRaw)) {
    return NextResponse.json({ error: "invalid batchMode" }, { status: 400 });
  }
  const batchMode = source === "batch" && isAssetBatchMode(batchModeRaw) ? batchModeRaw : null;
  const days = (searchParams.get("days") || "all").trim().toLowerCase();
  const typeFilter = (searchParams.get("type") || "all").trim().toLowerCase();
  const wantsCount = searchParams.get("count") === "1";
  const cursor = decodeCursor(searchParams.get("cursor"));

  const authUserId = await getUserId(req);
  if (!authUserId) {
    return wantsCount
      ? NextResponse.json({ total: 0 })
      : NextResponse.json({ items: [], nextCursor: null, hasMore: false });
  }

  const { isImport, where, sqlWhere } = buildAssetFilters({
    authUserId,
    tab,
    q,
    source,
    batchMode,
    typeFilter,
    days,
  });

  const detailId = searchParams.get("detailId");
  if (detailId !== null) {
    const id = Number(detailId);
    if (!Number.isSafeInteger(id) || id <= 0) return NextResponse.json({ error: apiMessage("m39a179be21a4") }, { status: 400 });
    const head = await prisma.generation.findFirst({ where: { AND: [where, { id }] } });
    if (!head) return NextResponse.json({ error: apiMessage("m9b4842275331") }, { status: 404 });
    const taskId = String(head.externalTaskId || "").trim();
    const rows = taskId ? await prisma.generation.findMany({
      where: { AND: [where, { type: head.type, externalTaskId: head.externalTaskId }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_SCANNED_ROWS,
    }) : [head];
    const [item] = await hydrateRows(rows, authUserId, isImport);
    return NextResponse.json({ item: item ? { ...item, detailPending: false } : null }, { headers: { "Cache-Control": "private, no-store" } });
  }

  if (wantsCount) {
    const total = await countAssets(sqlWhere);
    return NextResponse.json({ total });
  }

  if (all) {
    if (!isAdminRequest(req)) {
      return NextResponse.json({ error: "Admin required for all=1" }, { status: 403 });
    }
    const rows = await prisma.generation.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_ADMIN_ALL_TAKE,
      ...(skip ? { skip } : {})
    });
    const items = await hydrateRows(rows, authUserId, isImport);
    return NextResponse.json({ items, nextCursor: null, hasMore: rows.length >= MAX_ADMIN_ALL_TAKE });
  }

  const cardsOnly = searchParams.get("view") === "cards";
  const order = searchParams.get("order") === "asc" ? "asc" : "desc";
  const page = await fetchPagedRows(where, take, cursor, cardsOnly, order);
  const hydrated = await hydrateRows(page.rows, authUserId, isImport, cardsOnly);
  const items = cardsOnly ? hydrated.map(toAssetCard) : hydrated;
  if (order === "asc") items.reverse();
  return NextResponse.json({ items, nextCursor: page.nextCursor, hasMore: page.hasMore }, { headers: { "Cache-Control": "private, no-store" } });
}
