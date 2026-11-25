import prisma from "@/lib/prisma";
import { getGenerationDisplayFields } from "@/lib/generation-display-assets";
import {
  extractInputMaterials,
  extractOutputPaths,
  parseJson,
  toIso,
  withAnd,
  type AdminUserWorksRow,
} from "@/lib/admin-user-works";

type AdminAssetFeedScope = {
  requestedUserId: string;
  authUserId: number | null;
  linkedUserIds: string[];
};

type FeedCursor = {
  createdAt: string | null;
  updatedAt: string | null;
  id: number | null;
};

export type AdminAssetFeedItem = {
  id: number;
  generationId: number;
  userId: string;
  authUserId?: number | null;
  type: string;
  status: string;
  mediaKind: string;
  displayKind: "image" | "video" | "audio";
  thumbUrl?: string | null;
  displayUrl?: string | null;
  previewUrl?: string | null;
  posterUrl?: string | null;
  localPath?: string | null;
  outputPaths: string[];
  inputMaterials: string[];
  errorMsg?: string | null;
  externalTaskId?: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt?: string | null;
};

const FEED_SELECT = {
  id: true,
  generationId: true,
  userId: true,
  authUserId: true,
  type: true,
  status: true,
  mediaKind: true,
  thumbUrl: true,
  displayUrl: true,
  previewUrl: true,
  posterUrl: true,
  localPath: true,
  outputPaths: true,
  inputMaterials: true,
  errorMsg: true,
  externalTaskId: true,
  createdAt: true,
  updatedAt: true,
  finishedAt: true,
} as const;

const GENERATION_FEED_SELECT = {
  id: true,
  userId: true,
  authUserId: true,
  type: true,
  source: true,
  prompt: true,
  model: true,
  status: true,
  externalProvider: true,
  externalTaskId: true,
  errorMsg: true,
  localPath: true,
  templateData: true,
  createdAt: true,
  updatedAt: true,
  finishedAt: true,
} as const;

function feedTable(db: any = prisma) {
  return db.adminAssetFeed;
}

function normalizeStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || "").trim()).filter(Boolean)));
}

function buildScopeWhere(scope: AdminAssetFeedScope) {
  if (typeof scope.authUserId === "number") {
    return {
      OR: [
        { authUserId: scope.authUserId },
        { authUserId: null, userId: { in: scope.linkedUserIds.length ? scope.linkedUserIds : [scope.requestedUserId] } },
      ],
    };
  }
  return { authUserId: null, userId: scope.requestedUserId };
}

function buildTypeFilter(typeFilter: string) {
  const normalized = String(typeFilter || "all").trim().toLowerCase();
  if (!normalized || normalized === "all") return {};
  if (normalized === "video") return { type: { in: ["video_gen", "video_generate"] } };
  if (normalized === "audio") return { type: "audio_gen" };
  if (normalized === "face_swap" || normalized === "image_edit" || normalized === "import") return { type: normalized };
  return {};
}

function buildDateFilter(dateFrom?: Date | null, dateTo?: Date | null) {
  const createdAt: Record<string, Date> = {};
  if (dateFrom) createdAt.gte = dateFrom;
  if (dateTo) createdAt.lte = dateTo;
  return Object.keys(createdAt).length ? { createdAt } : {};
}

function buildFeedWhere(scope: AdminAssetFeedScope, typeFilter: string, dateFrom?: Date | null, dateTo?: Date | null) {
  return withAnd(
    buildScopeWhere(scope),
    {
      status: { not: "deleted" },
      ...buildTypeFilter(typeFilter),
      ...buildDateFilter(dateFrom, dateTo),
    }
  );
}

function buildBeforeCursorWhere(beforeCreatedAt?: string | null, beforeId?: number | null) {
  const created = beforeCreatedAt ? new Date(beforeCreatedAt) : null;
  if (!created || Number.isNaN(created.getTime())) return {};
  if (beforeId && beforeId > 0) {
    return { OR: [{ createdAt: { lt: created } }, { AND: [{ createdAt: created }, { id: { lt: beforeId } }] }] };
  }
  return { createdAt: { lt: created } };
}

function buildSinceCursorWhere(sinceUpdatedAt?: string | null, sinceId?: number | null) {
  const updated = sinceUpdatedAt ? new Date(sinceUpdatedAt) : null;
  if (!updated || Number.isNaN(updated.getTime())) return {};
  if (sinceId && sinceId > 0) {
    return { OR: [{ updatedAt: { gt: updated } }, { AND: [{ updatedAt: updated }, { id: { gt: sinceId } }] }] };
  }
  return { updatedAt: { gte: updated } };
}

function toFeedItem(row: any): AdminAssetFeedItem {
  const outputPaths = normalizeStringArray(row.outputPaths);
  const inputMaterials = normalizeStringArray(row.inputMaterials);
  const isAudio = row.mediaKind === "audio" || getGenerationDisplayFields(row).displayKind === "audio";
  return {
    id: Number(row.generationId),
    generationId: Number(row.generationId),
    userId: String(row.userId || ""),
    authUserId: typeof row.authUserId === "number" ? row.authUserId : null,
    type: String(row.type || ""),
    status: String(row.status || ""),
    mediaKind: isAudio ? "audio" : String(row.mediaKind || "image"),
    displayKind: isAudio ? "audio" : String(row.mediaKind || "image") === "video" ? "video" : "image",
    thumbUrl: isAudio ? null : row.thumbUrl || null,
    displayUrl: isAudio ? row.localPath || row.displayUrl || null : row.displayUrl || null,
    previewUrl: isAudio ? null : row.previewUrl || null,
    posterUrl: isAudio ? null : row.posterUrl || null,
    localPath: row.localPath || null,
    outputPaths,
    inputMaterials,
    errorMsg: row.errorMsg || null,
    externalTaskId: row.externalTaskId || null,
    createdAt: toIso(row.createdAt) || new Date(0).toISOString(),
    updatedAt: toIso(row.updatedAt) || toIso(row.createdAt) || new Date(0).toISOString(),
    finishedAt: toIso(row.finishedAt),
  };
}

function feedCursorFromRow(row: any | null): FeedCursor | null {
  if (!row) return null;
  return {
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
    id: Number(row.id || 0),
  };
}

export function buildAdminAssetFeedData(row: AdminUserWorksRow) {
  const params = parseJson(row.templateData);
  const display = getGenerationDisplayFields({ type: row.type, localPath: row.localPath, templateData: params || row.templateData || null });
  const outputPaths = extractOutputPaths(params, row.localPath);
  const inputMaterials = extractInputMaterials(params, row as any);
  return {
    generationId: row.id,
    userId: row.userId,
    authUserId: typeof row.authUserId === "number" ? row.authUserId : null,
    type: row.type,
    status: row.status,
    mediaKind: display.displayKind,
    thumbUrl: display.thumbUrl || null,
    displayUrl: display.displayUrl || null,
    previewUrl: display.previewUrl || null,
    posterUrl: display.posterUrl || null,
    localPath: row.localPath || null,
    outputPaths,
    inputMaterials,
    errorMsg: row.errorMsg || null,
    externalTaskId: row.externalTaskId || null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    finishedAt: row.finishedAt || null,
    deletedAt: null,
  };
}

export async function upsertAdminAssetFeedForRows(rows: AdminUserWorksRow[], db: any = prisma) {
  if (!rows.length) return 0;
  await Promise.all(
    rows.map((row) => {
      const data = buildAdminAssetFeedData(row);
      return feedTable(db).upsert({
        where: { generationId: row.id },
        create: data,
        update: data,
      });
    })
  );
  return rows.length;
}

export async function upsertAdminAssetFeedForGenerationId(generationId: number) {
  const id = Math.floor(Number(generationId) || 0);
  if (!id) return null;
  const row = await prisma.generation.findUnique({
    where: { id },
    select: GENERATION_FEED_SELECT,
  });
  if (!row) return null;
  await upsertAdminAssetFeedForRows([row as AdminUserWorksRow]);
  return row.id;
}

export async function markAdminAssetFeedDeleted(generationIds: number[]) {
  const ids = Array.from(new Set(generationIds.map((id) => Math.floor(Number(id) || 0)).filter(Boolean)));
  if (!ids.length) return 0;
  const now = new Date();
  const result = await feedTable().updateMany({
    where: { generationId: { in: ids } },
    data: { status: "deleted", deletedAt: now, updatedAt: now },
  });
  return Number(result?.count || 0);
}

export async function syncRecentAdminAssetFeed(scope: AdminAssetFeedScope, limit: number, typeFilter: string, dateFrom?: Date | null, dateTo?: Date | null) {
  const rows = await prisma.generation.findMany({
    where: withAnd(
      buildScopeWhere(scope),
      {
        ...buildTypeFilter(typeFilter),
        ...buildDateFilter(dateFrom, dateTo),
      }
    ) as any,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    select: GENERATION_FEED_SELECT,
  });
  await upsertAdminAssetFeedForRows(rows as AdminUserWorksRow[]);
  return rows.length;
}

export async function getAdminAssetFeed(input: {
  scope: AdminAssetFeedScope;
  limit: number;
  typeFilter: string;
  beforeCreatedAt?: string | null;
  beforeId?: number | null;
  dateFrom?: Date | null;
  dateTo?: Date | null;
}) {
  const where = withAnd(
    buildFeedWhere(input.scope, input.typeFilter, input.dateFrom, input.dateTo),
    buildBeforeCursorWhere(input.beforeCreatedAt, input.beforeId)
  );
  let [total, rows] = await Promise.all([
    feedTable().count({ where: buildFeedWhere(input.scope, input.typeFilter, input.dateFrom, input.dateTo) }),
    feedTable().findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: input.limit,
      select: FEED_SELECT,
    }),
  ]);

  if (!rows.length && !input.beforeCreatedAt) {
    await syncRecentAdminAssetFeed(input.scope, input.limit, input.typeFilter, input.dateFrom, input.dateTo);
    [total, rows] = await Promise.all([
      feedTable().count({ where: buildFeedWhere(input.scope, input.typeFilter, input.dateFrom, input.dateTo) }),
      feedTable().findMany({
        where,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.limit,
        select: FEED_SELECT,
      }),
    ]);
  }

  const items = rows.map(toFeedItem);
  const last = rows[rows.length - 1] || null;
  const first = rows[0] || null;
  return {
    items,
    total,
    nextCursor: rows.length >= input.limit ? feedCursorFromRow(last) : null,
    latestCursor: feedCursorFromRow(first),
    serverTime: new Date().toISOString(),
  };
}

export async function getAdminAssetFeedChanges(input: {
  scope: AdminAssetFeedScope;
  sinceUpdatedAt: string | null;
  sinceId: number | null;
  limit: number;
  typeFilter: string;
  dateFrom?: Date | null;
  dateTo?: Date | null;
}) {
  const where = withAnd(
    buildFeedWhere(input.scope, input.typeFilter, input.dateFrom, input.dateTo),
    buildSinceCursorWhere(input.sinceUpdatedAt, input.sinceId)
  );
  const deletedWhere = withAnd(
    withAnd(buildScopeWhere(input.scope), buildTypeFilter(input.typeFilter)),
    {
      status: "deleted",
      ...buildSinceCursorWhere(input.sinceUpdatedAt, input.sinceId),
    }
  );
  const [rows, deletedRows] = await Promise.all([
    feedTable().findMany({
      where,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: input.limit,
      select: FEED_SELECT,
    }),
    feedTable().findMany({
      where: deletedWhere,
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      take: input.limit,
      select: { id: true, generationId: true, updatedAt: true },
    }),
  ]);
  const latestRow = [...rows, ...deletedRows].sort((a: any, b: any) => {
    const at = new Date(a.updatedAt).getTime();
    const bt = new Date(b.updatedAt).getTime();
    if (at !== bt) return bt - at;
    return Number(b.id || 0) - Number(a.id || 0);
  })[0] || null;
  return {
    items: rows.map(toFeedItem),
    deletedIds: deletedRows.map((row: any) => Number(row.generationId)).filter(Boolean),
    latestCursor: feedCursorFromRow(latestRow),
    serverTime: new Date().toISOString(),
  };
}
