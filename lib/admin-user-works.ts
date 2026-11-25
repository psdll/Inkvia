import prisma from "@/lib/prisma";
import {
  attachAssetBatchMode,
  buildAssetSourceWhere,
  isAssetBatchMode,
  resolveAssetSource,
  splitAssetSourceFilter,
  type AssetSourceFilterValue,
} from "@/lib/assets/source-filter";
import { getGenerationDisplayFields } from "@/lib/generation-display-assets";
import { normalizeMediaUrl } from "@/lib/media-url";
import { collectComparableMediaRefsByGenerationWhere, normalizeComparableMediaRef } from "@/lib/media-cleanup";
import {
  buildCreatedAtCursorWhere,
  getAdminWorksSyncCursor,
  splitAdminWorksPage,
  type AdminWorksPageCursor,
} from "@/lib/admin-user-works-cursor";

export type SafeJson = Record<string, any>;

export function isAdminWorksReadModelEnabled(env: Record<string, string | undefined> = process.env) {
  return env.ADMIN_WORKS_READ_MODEL === "1";
}

export type AdminUserWorksScope = {
  authUserId?: number | null;
  linkedGuestUserIds?: string[];
  generationWhere: Record<string, unknown>;
  logWhere: Record<string, unknown>;
};

export type AdminWorksIdentity = {
  adminKey: string;
  userId: string;
  authUserId: number | null;
};

export function parseAdminWorksAdminKey(value: string | null): AdminWorksIdentity | null {
  const adminKey = String(value || "").trim();
  const match = /^(auth|guest):(.+)$/.exec(adminKey);
  if (!match) return null;
  if (match[1] === "auth") {
    const authUserId = Number(match[2]);
    if (!Number.isSafeInteger(authUserId) || authUserId <= 0) return null;
    return { adminKey: `auth:${authUserId}`, userId: String(authUserId), authUserId };
  }
  const userId = match[2].trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(userId) || userId === "_builtin") return null;
  return { adminKey: `guest:${userId}`, userId, authUserId: null };
}

export type AdminUserWorksRow = {
  id: number;
  userId: string;
  authUserId?: number | null;
  type: string;
  source: string;
  prompt: string;
  model: string | null;
  status: string;
  externalProvider?: string | null;
  externalTaskId: string | null;
  errorMsg?: string | null;
  localPath: string | null;
  templateData?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  finishedAt: Date | string | null;
};

export function safePage(v: string | null, fallback = 1) {
  const n = Number(v || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.floor(n));
}

export function safePageSize(v: string | null, fallback = 20) {
  const n = Number(v || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1000, Math.max(1, Math.floor(n)));
}

export function safeLimit(v: string | null, fallback = 100) {
  const n = Number(v || fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(500, Math.max(1, Math.floor(n)));
}

export function toIso(value: Date | string | null | undefined) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseJson(text: string | null | undefined): SafeJson | null {
  if (!text) return null;
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    return v as SafeJson;
  } catch {
    return null;
  }
}

function hasMeaningfulValue(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length > 0;
  return true;
}

export function mergeParamsPreferFilled(
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
    if (!hasMeaningfulValue(prevVal) && hasMeaningfulValue(nextVal)) {
      out[key] = nextVal;
    }
  }
  return out;
}

function mergeMetadataList(logs: Array<{ generationId: number | null; metadata: string | null; action: string }>) {
  const merged = new Map<number, SafeJson>();
  for (const log of logs) {
    if (!log.generationId) continue;
    const parsed = parseJson(log.metadata);
    if (!parsed) continue;
    const prev = merged.get(log.generationId) || {};
    const next = { ...prev, ...parsed };
    if (log.action === "task_success" && Object.prototype.hasOwnProperty.call(prev, "duration")) {
      next.duration = (prev as any).duration;
    }
    merged.set(log.generationId, next);
  }
  return merged;
}

function toPathArray(v: any) {
  if (!Array.isArray(v)) return [] as string[];
  return v.map((x) => normalizeMediaUrl(x)).filter(Boolean);
}

export function extractOutputPaths(meta: SafeJson | null, localPath: string | null | undefined) {
  const out: string[] = [];
  const push = (v: any) => {
    const s = normalizeMediaUrl(v);
    if (!s) return;
    out.push(s);
  };
  const p = meta || {};
  push(localPath || "");
  toPathArray(p.outputPaths).forEach(push);
  toPathArray(p.output_images).forEach(push);
  toPathArray(p.image_urls).forEach(push);
  toPathArray(p.resultUrls).forEach(push);
  if (Array.isArray(p.outputs)) {
    for (const x of p.outputs) push((x as any)?.url || (x as any)?.video_url || x);
  }
  return Array.from(new Set(out));
}

export function extractInputMaterials(meta: SafeJson | null, generation: { type: string }) {
  const taskType = String(meta?.taskType || "").trim().toLowerCase();
  const mediaPath = String(meta?.mediaPath || "").trim();
  const inputUrl = String(meta?.inputUrl || meta?.image_url || "").trim();
  if (generation.type === "video_gen" || generation.type === "video_generate" || taskType === "video_gen" || taskType === "video_generate") {
    const videoInputs: string[] = [];
    const pushVideoInput = (v: any) => {
      const s = normalizeMediaUrl(v);
      if (!s || s.startsWith("asset://")) return;
      videoInputs.push(s);
    };
    if (Array.isArray(meta?.inputMedia)) {
      for (const item of meta.inputMedia) {
        pushVideoInput((item as any)?.url);
      }
    }
    pushVideoInput(meta?.inputPreviewUrl);
    pushVideoInput(mediaPath);
    pushVideoInput(inputUrl);
    if (videoInputs.length) return Array.from(new Set(videoInputs)).slice(0, 12);
  }
  const out: string[] = [];
  const push = (v: any) => {
    const s = normalizeMediaUrl(v);
    if (!s || s.startsWith("asset://")) return;
    out.push(s);
  };
  const pushArray = (v: any) => {
    if (!Array.isArray(v)) return;
    for (const x of v) push(x);
  };
  if (meta) {
    pushArray(meta.imagePaths);
    pushArray(meta.inputImages);
    pushArray(meta.inputPaths);
    pushArray(meta.sourceImages);
    pushArray(meta.fileUrls);
    pushArray(meta.image_urls);
    pushArray(meta.output_images);
    push(meta.imagePath);
    push(meta.sourcePath);
    push(mediaPath);
    push(meta.localInputPath);
    push(meta.facePath);
    push(meta.targetPath);
    push(meta.fileUrl);
    push(inputUrl);
  }
  return Array.from(new Set(out)).slice(0, 12);
}

export function withAnd(base: Record<string, unknown>, extra?: Record<string, unknown>) {
  if (!extra || Object.keys(extra).length === 0) return base;
  return { AND: [base, extra] };
}

export type AdminWorksSourceFilter = AssetSourceFilterValue;

export function normalizeAdminWorksSourceFilter(
  source: string | null | undefined,
  batchMode?: string | null,
): AdminWorksSourceFilter {
  const normalized = String(source || "").trim().toLowerCase();
  if (normalized.startsWith("batch:")) {
    const mode = normalized.slice("batch:".length);
    return isAssetBatchMode(mode) ? `batch:${mode}` : "batch";
  }
  if (normalized === "batch") {
    return isAssetBatchMode(batchMode) ? `batch:${batchMode}` : "batch";
  }
  return normalized === "tool" || normalized === "canvas" || normalized === "agent" ? normalized : "creation";
}

export function buildWorksListFilter(kind: string, typeFilter: string, sourceFilter: string = "creation") {
  const listFilter: Record<string, unknown> = kind === "import" ? { type: "import" } : kind === "generated" ? { type: { not: "import" } } : {};
  if (typeFilter && typeFilter !== "all") {
    if (typeFilter === "video") listFilter.type = { in: ["video_gen", "video_generate"] };
    else if (typeFilter === "audio") listFilter.type = "audio_gen";
    else if (typeFilter === "face_swap" || typeFilter === "image_edit" || typeFilter === "import") listFilter.type = typeFilter;
  }
  if (typeFilter !== "import") {
    const parsed = splitAssetSourceFilter(normalizeAdminWorksSourceFilter(sourceFilter));
    Object.assign(listFilter, buildAssetSourceWhere(parsed.source, parsed.batchMode) || {});
  }
  return listFilter;
}

function canUseAdminWorksReadModel(sourceFilter: string = "creation") {
  const source = splitAssetSourceFilter(normalizeAdminWorksSourceFilter(sourceFilter)).source;
  return source === "creation" || source === "canvas";
}

export async function buildWorksWhere(scope: AdminUserWorksScope, kind: string, typeFilter: string, sourceFilter: string = "creation") {
  const listFilter = buildWorksListFilter(kind, typeFilter, sourceFilter);
  let listWhere: any = withAnd(scope.generationWhere, listFilter);

  if (typeFilter === "import") {
    const nonImportRefs = await collectComparableMediaRefsByGenerationWhere(
      withAnd(scope.generationWhere, { type: { not: "import" } }) as any
    );
    const importRows = await prisma.generation.findMany({
      where: withAnd(scope.generationWhere, { type: "import" }) as any,
      select: { id: true, localPath: true }
    });
    const unreferencedImportIds = importRows
      .filter((row) => {
        const comp = normalizeComparableMediaRef(row.localPath || "");
        return !comp || !nonImportRefs.has(comp);
      })
      .map((row) => row.id);
    listWhere = withAnd(listWhere, {
      id: { in: unreferencedImportIds.length ? unreferencedImportIds : [-1] }
    });
  }

  return listWhere;
}

export async function getAdminUserWorkIds(input: {
  scope: AdminUserWorksScope;
  kind: string;
  typeFilter: string;
  sourceFilter: AssetSourceFilterValue;
  from: Date | null;
  to: Date | null;
}): Promise<number[]> {
  const where = withAnd(await buildWorksWhere(input.scope, input.kind, input.typeFilter, input.sourceFilter),
    input.from || input.to ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {});
  const rows = await prisma.generation.findMany({ where: where as any, select: { id: true } });
  return rows.map((row) => row.id);
}

export async function getAdminUserFailedWorkIds(scope: AdminUserWorksScope): Promise<number[]> {
  const rows = await prisma.generation.findMany({
    where: withAnd(scope.generationWhere, { type: { not: "import" }, status: "failed" }) as any,
    select: { id: true },
  });
  return rows.map((row) => row.id);
}

function mapGenerationWhereToWorkFeed(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(mapGenerationWhereToWorkFeed);
  if (!value || typeof value !== "object" || value instanceof Date) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, nested]) => [
      key === "id" ? "generationId" : key,
      mapGenerationWhereToWorkFeed(nested),
    ]),
  );
}

function getWorkFeedIdentityBranches(
  scope: AdminUserWorksScope,
  kind: string,
  typeFilter: string,
  sourceFilter: string,
): Array<Record<string, unknown>> | null {
  if (!Number.isSafeInteger(scope.authUserId) || Number(scope.authUserId) <= 0 || typeFilter === "import") {
    return null;
  }
  const linkedGuestUserIds = Array.from(new Set(
    (scope.linkedGuestUserIds || []).map((value) => String(value || "").trim()).filter(Boolean),
  ));
  if (!linkedGuestUserIds.length) return null;
  const listFilter = buildWorksListFilter(kind, typeFilter, sourceFilter);
  return [
    mapGenerationWhereToWorkFeed(withAnd({ authUserId: Number(scope.authUserId) }, listFilter)) as Record<string, unknown>,
    ...linkedGuestUserIds.map((userId) => (
      mapGenerationWhereToWorkFeed(withAnd({ authUserId: null, userId }, listFilter)) as Record<string, unknown>
    )),
  ];
}

function compareFeedRows(a: any, b: any, mode: "created" | "updated" | "event") {
  const keyA = mode === "event"
    ? Number(a.sourceEventId)
    : new Date(mode === "created" ? a.createdAt : a.updatedAt).getTime();
  const keyB = mode === "event"
    ? Number(b.sourceEventId)
    : new Date(mode === "created" ? b.createdAt : b.updatedAt).getTime();
  if (keyA !== keyB) return mode === "created" ? keyB - keyA : keyA - keyB;
  const idDiff = Number(a.generationId) - Number(b.generationId);
  return mode === "created" ? -idDiff : idDiff;
}

const workFeedSelect = {
  generationId: true,
  sourceEventId: true,
  userId: true,
  authUserId: true,
  type: true,
  status: true,
  source: true,
  provider: true,
  model: true,
  mediaKind: true,
  thumbUrl: true,
  previewUrl: true,
  displayUrl: true,
  posterUrl: true,
  errorMsg: true,
  createdAt: true,
  finishedAt: true,
  updatedAt: true,
  deletedAt: true,
} as const;

const generationSelect = {
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

async function hydrateWorksRows(scope: AdminUserWorksScope, rows: AdminUserWorksRow[], cardsOnly = false) {
  if (cardsOnly) return rows.map((row) => {
    const params = parseJson(row.templateData);
    const display = getGenerationDisplayFields(row);
    return {
      id: row.id, userId: row.userId, authUserId: row.authUserId,
      type: row.type, source: resolveAssetSource(row.source, params),
      prompt: row.prompt.slice(0, 160), model: row.model, status: row.status,
      externalProvider: row.externalProvider, externalTaskId: row.externalTaskId,
      errorMsg: row.errorMsg?.slice(0, 500) || null, localPath: row.localPath,
      createdAt: row.createdAt, updatedAt: row.updatedAt, finishedAt: row.finishedAt,
      ...display, params: null, inputMaterials: [],
      outputPaths: row.localPath ? [row.localPath] : [], detailsLoaded: false,
    };
  });
  const externalTaskIds = Array.from(new Set(rows.map((g) => String(g.externalTaskId || "").trim()).filter(Boolean)));
  const peerRows =
    externalTaskIds.length > 0
      ? await prisma.generation.findMany({
          where: withAnd(scope.generationWhere, { externalTaskId: { in: externalTaskIds } }) as any,
          select: { id: true, type: true, externalTaskId: true, localPath: true, templateData: true, updatedAt: true }
        })
      : [];

  const generationIds = Array.from(new Set([...rows.map((g) => g.id), ...peerRows.map((g) => g.id)]));
  const [generationLogs, batchOutputs, liveVideoBatchOutputs] = generationIds.length
    ? await Promise.all([
        prisma.log.findMany({
          where: {
            ...(scope.logWhere as any),
            generationId: { in: generationIds },
            category: "generation",
            action: { in: ["task_create", "task_success"] },
            metadata: { not: null }
          },
          orderBy: { createdAt: "asc" }
        }),
        prisma.imageBatchOutput.findMany({
          where: { generationId: { in: generationIds } },
          select: {
            generationId: true,
            batch: { select: { mode: true } },
          },
        }),
        prisma.liveVideoBatchOutput.findMany({
          where: { generationId: { in: generationIds } },
          select: { generationId: true },
        }),
      ])
    : [[], [], []];

  const paramsByGeneration = new Map<number, SafeJson | null>();
  const mergedMeta = mergeMetadataList(generationLogs as Array<{ generationId: number | null; metadata: string | null; action: string }>);
  for (const row of [...rows, ...peerRows] as Array<{ id: number; templateData?: string | null }>) {
    paramsByGeneration.set(row.id, mergeParamsPreferFilled(parseJson(row.templateData), mergedMeta.get(row.id) || null));
  }
  for (const output of batchOutputs) {
    if (!output.generationId) continue;
    paramsByGeneration.set(
      output.generationId,
      attachAssetBatchMode(paramsByGeneration.get(output.generationId), output.batch.mode),
    );
  }
  for (const output of liveVideoBatchOutputs) {
    if (!output.generationId) continue;
    paramsByGeneration.set(
      output.generationId,
      attachAssetBatchMode(paramsByGeneration.get(output.generationId), "live_video"),
    );
  }
  const groupedOutputPaths = new Map<string, string[]>();
  const groupedInputMaterials = new Map<string, string[]>();
  const groupedParams = new Map<string, SafeJson | null>();
  const allRowsForGrouping = Array.from(
    new Map<number, { id: number; type: string; externalTaskId: string | null; localPath: string | null }>(
      [...rows, ...peerRows].map((x) => [x.id, x])
    ).values()
  );

  for (const row of allRowsForGrouping) {
    const key = String(row.externalTaskId || "").trim() ? `${row.type}:${String(row.externalTaskId || "").trim()}` : `id:${row.id}`;
    const params = paramsByGeneration.get(row.id) ?? null;
    groupedOutputPaths.set(key, Array.from(new Set([...(groupedOutputPaths.get(key) || []), ...extractOutputPaths(params, row.localPath)])));
    groupedInputMaterials.set(key, Array.from(new Set([...(groupedInputMaterials.get(key) || []), ...extractInputMaterials(params, row as any)])));
    groupedParams.set(key, mergeParamsPreferFilled(groupedParams.get(key) || null, params));
  }

  return rows.map((g) => {
    const key = String(g.externalTaskId || "").trim() ? `${g.type}:${String(g.externalTaskId || "").trim()}` : `id:${g.id}`;
    const params = groupedParams.get(key) || paramsByGeneration.get(g.id) || null;
    const display = getGenerationDisplayFields({ type: g.type, localPath: g.localPath, templateData: params || g.templateData || null });
    return {
      ...g,
      source: resolveAssetSource(g.source, params),
      ...display,
      params,
      inputMaterials: groupedInputMaterials.get(key) || extractInputMaterials(params, g),
      outputPaths: groupedOutputPaths.get(key) || extractOutputPaths(params, g.localPath),
    };
  });
}

async function hydrateWorkFeedRows(scope: AdminUserWorksScope, feedRows: any[], cardsOnly = false) {
  if (!feedRows.length) return [];
  const generationRows = await prisma.generation.findMany({
    where: withAnd(scope.generationWhere, { id: { in: feedRows.map((row) => Number(row.generationId)) } }) as any,
    select: generationSelect,
  });
  const hydrated = await hydrateWorksRows(scope, generationRows as AdminUserWorksRow[], cardsOnly);
  const hydratedById = new Map(hydrated.map((row) => [Number(row.id), row]));
  return feedRows.flatMap((feed) => {
    const row = hydratedById.get(Number(feed.generationId));
    if (!row) return [];
    return [{
      ...row,
      userId: String(feed.userId || row.userId),
      authUserId: typeof feed.authUserId === "number" ? feed.authUserId : null,
      type: String(feed.type || row.type),
      status: String(feed.status || row.status),
      source: resolveAssetSource(feed.source || row.source, row.params),
      model: feed.model || row.model || null,
      externalProvider: feed.provider || row.externalProvider || null,
      displayKind: row.displayKind === "audio" ? "audio" : feed.mediaKind === "video" ? "video" : "image",
      thumbUrl: row.displayKind === "audio" ? null : feed.thumbUrl || row.thumbUrl || null,
      previewUrl: row.displayKind === "audio" ? null : feed.previewUrl || row.previewUrl || null,
      displayUrl: row.displayKind === "audio" ? row.displayUrl : feed.displayUrl || row.displayUrl || null,
      posterUrl: row.displayKind === "audio" ? null : feed.posterUrl || row.posterUrl || null,
      errorMsg: feed.errorMsg || row.errorMsg || null,
      createdAt: feed.createdAt,
      finishedAt: feed.finishedAt || null,
      updatedAt: feed.updatedAt,
    }];
  });
}

async function getAdminEventProjectionFrontier(db: any = prisma): Promise<number> {
  const rows = await db.$queryRawUnsafe(
    `SELECT COALESCE(
       (SELECT "id" - 1 FROM "AdminEvent" WHERE "status" <> 'done' ORDER BY "id" ASC LIMIT 1),
       (SELECT "id" FROM "AdminEvent" ORDER BY "id" DESC LIMIT 1),
       0
     )::int AS "sourceEventId"`,
  );
  return Math.max(0, Number(rows?.[0]?.sourceEventId) || 0);
}

async function getAdminUserWorksFromFeed(input: {
  scope: AdminUserWorksScope;
  page: number;
  pageSize: number;
  kind: string;
  typeFilter: string;
  sourceFilter?: string;
  cardsOnly?: boolean;
  all?: boolean;
  cursor?: AdminWorksPageCursor | null;
}) {
  const generationWhere = await buildWorksWhere(input.scope, input.kind, input.typeFilter, input.sourceFilter);
  const baseWhere = withAnd(
    mapGenerationWhereToWorkFeed(generationWhere) as Record<string, unknown>,
    { deletedAt: null },
  );
  const cursorWhere = input.cursor
    ? mapGenerationWhereToWorkFeed(buildCreatedAtCursorWhere(input.cursor)) as Record<string, unknown>
    : {};
  const where = withAnd(baseWhere, cursorWhere);
  const listArgs: any = {
    where,
    orderBy: [{ createdAt: "desc" }, { generationId: "desc" }],
    select: workFeedSelect,
  };
  if (!input.all) {
    if (!input.cursor && input.page > 1) listArgs.skip = (input.page - 1) * input.pageSize;
    listArgs.take = input.pageSize + 1;
  }
  const feed = (prisma as any).adminWorkFeed;
  const requiresExactTotal = input.all || input.typeFilter === "import";
  const identityBranches = input.all
    ? null
    : getWorkFeedIdentityBranches(input.scope, input.kind, input.typeFilter, input.sourceFilter || "creation");
  const rawRowsPromise = identityBranches
    ? Promise.all(identityBranches.map((branch) => feed.findMany({
        where: withAnd(withAnd(branch, { deletedAt: null }), cursorWhere),
        orderBy: listArgs.orderBy,
        select: workFeedSelect,
        take: Math.max(1, Number(listArgs.skip || 0) + Number(listArgs.take || input.pageSize + 1)),
      }))).then((pages) => pages
        .flat()
        .sort((a, b) => compareFeedRows(a, b, "created"))
        .slice(Number(listArgs.skip || 0), Number(listArgs.skip || 0) + Number(listArgs.take || input.pageSize + 1)))
    : feed.findMany(listArgs);
  const [sourceEventId, total, rawRows] = await Promise.all([
    getAdminEventProjectionFrontier(),
    requiresExactTotal ? feed.count({ where: baseWhere }) : Promise.resolve(null),
    rawRowsPromise,
  ]);
  const split = input.all
    ? { items: rawRows, hasMore: false, nextCursor: null }
    : splitAdminWorksPage(
        rawRows.map((row: any) => ({ ...row, id: Number(row.generationId) })),
        input.pageSize,
      );
  const generations = await hydrateWorkFeedRows(input.scope, split.items, input.cardsOnly);
  return {
    generations,
    pagination: {
      page: input.all ? 1 : input.page,
      pageSize: input.all ? Number(total || 0) : input.pageSize,
      nextCursor: split.nextCursor,
      total,
      totalPages: input.all ? 1 : total == null ? null : Math.max(1, Math.ceil(total / input.pageSize)),
      hasMore: split.hasMore,
      kind: input.kind === "import" || input.kind === "generated" ? input.kind : "all",
    },
    syncCursor: {
      ...getAdminWorksSyncCursor(generations, new Date(0)),
      sourceEventId,
    },
    serverTime: new Date().toISOString(),
  };
}

async function getAdminUserWorksChangesFromFeed(input: {
  scope: AdminUserWorksScope;
  sinceUpdatedAt: string | null;
  sinceId: number | null;
  sinceSourceEventId?: number | null;
  limit: number;
  kind: string;
  typeFilter: string;
  sourceFilter?: string;
  cardsOnly?: boolean;
}) {
  const generationWhere = await buildWorksWhere(input.scope, input.kind, input.typeFilter, input.sourceFilter);
  const baseWhere = mapGenerationWhereToWorkFeed(generationWhere) as Record<string, unknown>;
  const since = input.sinceUpdatedAt ? new Date(input.sinceUpdatedAt) : null;
  const sinceValid = since && !Number.isNaN(since.getTime()) ? since : null;
  const hasEventCursor = Number.isSafeInteger(input.sinceSourceEventId)
    && Number(input.sinceSourceEventId) >= 0;
  const projectionFrontier = hasEventCursor
    ? Math.max(Number(input.sinceSourceEventId), await getAdminEventProjectionFrontier())
    : null;
  const cursorWhere = hasEventCursor
    ? { sourceEventId: { gt: Number(input.sinceSourceEventId), lte: projectionFrontier } }
    : sinceValid && input.sinceId != null
      ? {
        OR: [
          { updatedAt: { gt: sinceValid } },
          { AND: [{ updatedAt: sinceValid }, { generationId: { gt: input.sinceId } }] },
        ],
      }
      : {};
  const orderBy = hasEventCursor
    ? [{ sourceEventId: "asc" }, { generationId: "asc" }]
    : [{ updatedAt: "asc" }, { generationId: "asc" }];
  const feed = (prisma as any).adminWorkFeed;
  const identityBranches = getWorkFeedIdentityBranches(input.scope, input.kind, input.typeFilter, input.sourceFilter || "creation");
  const rows = identityBranches
    ? (await Promise.all(identityBranches.map((branch) => feed.findMany({
        where: withAnd(branch, cursorWhere),
        orderBy,
        take: input.limit + 1,
        select: workFeedSelect,
      })))).flat().sort((a, b) => compareFeedRows(a, b, hasEventCursor ? "event" : "updated")).slice(0, input.limit + 1)
    : await feed.findMany({
        where: withAnd(baseWhere, cursorWhere),
        orderBy,
        take: input.limit + 1,
        select: workFeedSelect,
      });
  const page = rows.slice(0, input.limit);
  const activeRows = page.filter((row: any) => !row.deletedAt);
  const generations = await hydrateWorkFeedRows(input.scope, activeRows, input.cardsOnly);
  const last = page[page.length - 1];
  const hasMore = rows.length > input.limit;
  return {
    generations,
    deletedIds: page.filter((row: any) => row.deletedAt).map((row: any) => Number(row.generationId)),
    nextCursor: last
      ? {
          updatedAt: toIso(last.updatedAt),
          id: Number(last.generationId),
          sourceEventId: hasEventCursor && !hasMore ? projectionFrontier : Number(last.sourceEventId),
        }
      : {
          updatedAt: sinceValid?.toISOString() || new Date().toISOString(),
          id: input.sinceId || 0,
          ...(hasEventCursor ? { sourceEventId: projectionFrontier } : {}),
        },
    hasMore,
    serverTime: new Date().toISOString(),
  };
}

export async function getAdminUserWorks(input: {
  scope: AdminUserWorksScope;
  page: number;
  pageSize: number;
  kind: string;
  typeFilter: string;
  sourceFilter?: string;
  cardsOnly?: boolean;
  from?: Date | null;
  to?: Date | null;
  all?: boolean;
  cursor?: AdminWorksPageCursor | null;
}) {
  const sourceFilter = input.sourceFilter || "creation";
  if (!input.from && !input.to && isAdminWorksReadModelEnabled() && canUseAdminWorksReadModel(sourceFilter)) {
    return getAdminUserWorksFromFeed(input);
  }
  const baseWhere = withAnd(await buildWorksWhere(input.scope, input.kind, input.typeFilter, input.sourceFilter),
    input.from || input.to ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } } : {});
  const listWhere = input.cursor
    ? withAnd(baseWhere as Record<string, unknown>, buildCreatedAtCursorWhere(input.cursor))
    : baseWhere;
  const listArgs: any = {
    where: listWhere,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: generationSelect
  };
  if (!input.all) {
    if (!input.cursor && input.page > 1) listArgs.skip = (input.page - 1) * input.pageSize;
    listArgs.take = input.pageSize + 1;
  }
  const [total, rows] = await Promise.all([
    prisma.generation.count({ where: baseWhere }),
    prisma.generation.findMany(listArgs)
  ]);
  const page = input.all
    ? { items: rows as AdminUserWorksRow[], hasMore: false, nextCursor: null }
    : splitAdminWorksPage(rows as AdminUserWorksRow[], input.pageSize);
  const generations = await hydrateWorksRows(input.scope, page.items, input.cardsOnly);
  const totalPages = input.all ? 1 : Math.max(1, Math.ceil(total / input.pageSize));
  const serverTime = new Date();
  return {
    generations,
    pagination: {
      page: input.all ? 1 : input.page,
      pageSize: input.all ? total : input.pageSize,
      nextCursor: page.nextCursor,
      total,
      totalPages,
      hasMore: page.hasMore,
      kind: input.kind === "import" || input.kind === "generated" ? input.kind : "all"
    },
    syncCursor: getAdminWorksSyncCursor(page.items, new Date(0)),
    serverTime: serverTime.toISOString()
  };
}

export async function getAdminUserWorksChanges(input: {
  scope: AdminUserWorksScope;
  sinceUpdatedAt: string | null;
  sinceId: number | null;
  sinceSourceEventId?: number | null;
  limit: number;
  kind: string;
  typeFilter: string;
  sourceFilter?: string;
  cardsOnly?: boolean;
}) {
  const sourceFilter = input.sourceFilter || "creation";
  if (isAdminWorksReadModelEnabled() && canUseAdminWorksReadModel(sourceFilter)) {
    return getAdminUserWorksChangesFromFeed(input);
  }
  const baseWhere = await buildWorksWhere(input.scope, input.kind, input.typeFilter, input.sourceFilter);
  const since = input.sinceUpdatedAt ? new Date(input.sinceUpdatedAt) : null;
  const sinceValid = since && !Number.isNaN(since.getTime()) ? since : null;
  const cursorWhere = sinceValid && input.sinceId != null
    ? { OR: [{ updatedAt: { gt: sinceValid } }, { AND: [{ updatedAt: sinceValid }, { id: { gt: input.sinceId } }] }] }
    : {};

  const rows = await prisma.generation.findMany({
    where: withAnd(baseWhere as Record<string, unknown>, cursorWhere),
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
    take: input.limit + 1,
    select: generationSelect
  });
  const page = rows.slice(0, input.limit) as AdminUserWorksRow[];
  const generations = await hydrateWorksRows(input.scope, page, input.cardsOnly);
  const last = generations[generations.length - 1] as any;
  return {
    generations,
    deletedIds: [],
    nextCursor: last
      ? { updatedAt: toIso(last.updatedAt), id: last.id }
      : { updatedAt: sinceValid?.toISOString() || new Date().toISOString(), id: input.sinceId || 0 },
    hasMore: rows.length > input.limit,
    serverTime: new Date().toISOString()
  };
}

export async function getAdminUserWorkDetail(scope: AdminUserWorksScope, id: number) {
  const rows = await prisma.generation.findMany({
    where: withAnd(scope.generationWhere, { id }) as any, select: generationSelect, take: 1,
  });
  if (!rows.length) return null;
  const [detail] = await hydrateWorksRows(scope, rows as AdminUserWorksRow[]);
  return { ...detail, detailsLoaded: true };
}
