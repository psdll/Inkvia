import prisma from "@/lib/prisma";

export type AdminSummaryCursor = {
  updatedAt: Date;
  adminKey: string;
};

export type AdminSummaryPageCursor = {
  lastActiveAt: Date | null;
  adminKey: string;
};

export type AdminUserSummaryItem = {
  adminKey: string;
  userId: string;
  username: string | null;
  generationCount: number;
  lastCreatedAt: string | null;
  summaryUpdatedAt: string;
  authUserId: number | null;
  linkedUserIds: string[];
  deviceCount: number;
};

export type TombstoneAdminUserSummaryInput = {
  userId: string;
  authUserId?: number | null;
  linkedGuestUserIds?: string[];
  deletedAt?: Date;
};

export async function tombstoneAdminUserSummary(
  input: TombstoneAdminUserSummaryInput,
  db: any = prisma,
) {
  const userId = String(input.userId || "").trim();
  const authUserId = typeof input.authUserId === "number"
    && Number.isSafeInteger(input.authUserId)
    && input.authUserId > 0
    ? input.authUserId
    : null;
  const linkedGuestUserIds = Array.from(new Set(
    (input.linkedGuestUserIds || []).map((value) => String(value || "").trim()).filter(Boolean),
  ));
  if (authUserId == null && userId) linkedGuestUserIds.unshift(userId);
  const guestAdminKeys = Array.from(new Set(linkedGuestUserIds)).map((value) => `guest:${value}`);
  const OR: Array<Record<string, unknown>> = [];
  if (authUserId != null) OR.push({ adminKey: `auth:${authUserId}` }, { authUserId });
  if (guestAdminKeys.length) OR.push({ adminKey: { in: guestAdminKeys } });
  if (!OR.length) return { count: 0 };
  const deletedAt = input.deletedAt || new Date();
  return db.adminUserSummary.updateMany({
    where: { deletedAt: null, OR },
    data: { deletedAt, updatedAt: deletedAt },
  });
}

const ADMIN_KEY_PATTERN = /^(?:auth:\d+|guest:[a-zA-Z0-9_-]{1,64})?$/;

export function isAdminSummaryReadModelEnabled(
  env: Record<string, string | undefined> = process.env,
) {
  return env.ADMIN_SUMMARY_READ_MODEL === "1";
}

export async function isAdminSummaryReadModelReady(
  env: Record<string, string | undefined> = process.env,
  db: any = prisma,
) {
  if (!isAdminSummaryReadModelEnabled(env)) return false;
  const row = await db.appSetting.findUnique({
    where: { key: "admin_user_summary_backfill_complete" },
    select: { value: true },
  });
  try {
    const snapshot = JSON.parse(String(row?.value || ""));
    return snapshot?.version === 1 && typeof snapshot?.completedAt === "string";
  } catch {
    return false;
  }
}

export function encodeAdminSummaryCursor(cursor: AdminSummaryCursor): string {
  return Buffer.from(JSON.stringify({
    updatedAt: cursor.updatedAt.toISOString(),
    adminKey: cursor.adminKey,
  })).toString("base64url");
}

export function decodeAdminSummaryCursor(value: string): AdminSummaryCursor {
  try {
    const parsed = JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
    const updatedAt = new Date(parsed?.updatedAt);
    const adminKey = String(parsed?.adminKey || "");
    if (Number.isNaN(updatedAt.getTime()) || !ADMIN_KEY_PATTERN.test(adminKey)) throw new Error();
    return { updatedAt, adminKey };
  } catch {
    throw new Error("invalid summary cursor");
  }
}

export function encodeAdminSummaryPageCursor(cursor: AdminSummaryPageCursor): string {
  return Buffer.from(JSON.stringify({
    lastActiveAt: cursor.lastActiveAt?.toISOString() || null,
    adminKey: cursor.adminKey,
  })).toString("base64url");
}

export function decodeAdminSummaryPageCursor(value: string): AdminSummaryPageCursor {
  try {
    const parsed = JSON.parse(Buffer.from(String(value || ""), "base64url").toString("utf8"));
    const adminKey = String(parsed?.adminKey || "");
    const lastActiveAt = parsed?.lastActiveAt == null ? null : new Date(parsed.lastActiveAt);
    if (!adminKey || !ADMIN_KEY_PATTERN.test(adminKey) || (lastActiveAt && Number.isNaN(lastActiveAt.getTime()))) {
      throw new Error();
    }
    return { lastActiveAt, adminKey };
  } catch {
    throw new Error("invalid summary page cursor");
  }
}

function toIso(value: unknown): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseLinkedUserIds(value: unknown, fallback: string): string[] {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      candidate = [];
    }
  }
  const values = Array.isArray(candidate) ? candidate : [];
  const linked = Array.from(new Set(values.map((item) => String(item || "").trim()).filter(Boolean))).sort();
  return linked.length ? linked : [fallback];
}

export function mapSummaryRow(row: any): AdminUserSummaryItem {
  const userId = String(row.userId || row.adminKey?.replace(/^(?:auth|guest):/, "") || "");
  return {
    adminKey: String(row.adminKey),
    userId,
    username: row.username == null ? null : String(row.username),
    generationCount: Math.max(0, Number(row.totalTaskCount) || 0),
    lastCreatedAt: toIso(row.lastActiveAt),
    summaryUpdatedAt: toIso(row.updatedAt) || new Date(0).toISOString(),
    authUserId: typeof row.authUserId === "number" ? row.authUserId : null,
    linkedUserIds: parseLinkedUserIds(row.linkedUserIds, userId),
    deviceCount: Math.max(1, Number(row.deviceCount) || 1),
  };
}

function compareSummaryPageRows(a: any, b: any) {
  const aTime = a.lastActiveAt == null ? Number.NEGATIVE_INFINITY : new Date(a.lastActiveAt).getTime();
  const bTime = b.lastActiveAt == null ? Number.NEGATIVE_INFINITY : new Date(b.lastActiveAt).getTime();
  if (aTime !== bTime) return bTime - aTime;
  return String(a.adminKey).localeCompare(String(b.adminKey));
}

function compareSummaryChangeRows(a: any, b: any) {
  const timeDiff = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  if (timeDiff !== 0) return timeDiff;
  return String(a.adminKey).localeCompare(String(b.adminKey));
}

export async function listAdminUserSummariesFromReadModel(input: number | {
  limit?: number;
  pageCursor?: string | null;
  q?: string;
  page?: number;
} = {}): Promise<{
  items: AdminUserSummaryItem[];
  summaryCursor: string | null;
  nextPageCursor: string | null;
  hasMore: boolean;
}> {
  const options = typeof input === "number" ? { limit: input } : input;
  const take = Math.max(1, Math.min(500, Math.floor(Number(options.limit) || 500)));
  const pageCursor = options.pageCursor ? decodeAdminSummaryPageCursor(options.pageCursor) : null;
  const table = (prisma as any).adminUserSummary;
  const q = String(options.q || '').trim().slice(0, 100);
  const search = q ? { OR: [{ username: { contains: q, mode: 'insensitive' } }, { userId: { contains: q, mode: 'insensitive' } }, { adminKey: { contains: q, mode: 'insensitive' } }] } : {};
  const highWaterPromise = table.findFirst({
    orderBy: [{ updatedAt: "desc" }, { adminKey: "desc" }],
    select: { updatedAt: true, adminKey: true },
  });
  const orderBy = [{ lastActiveAt: { sort: "desc", nulls: "last" } }, { adminKey: "asc" }];
  let rowsPromise: Promise<any[]>;
  if (pageCursor?.lastActiveAt) {
    const branchWheres = [
      { deletedAt: null, lastActiveAt: pageCursor.lastActiveAt, adminKey: { gt: pageCursor.adminKey } },
      { deletedAt: null, lastActiveAt: { lt: pageCursor.lastActiveAt } },
      { deletedAt: null, lastActiveAt: null },
    ];
    rowsPromise = Promise.all(branchWheres.map((where) => table.findMany({
      where: q ? { AND: [where, search] } : where,
      orderBy,
      take: take + 1,
    }))).then((pages) => pages.flat().sort(compareSummaryPageRows).slice(0, take + 1));
  } else if (pageCursor) {
    rowsPromise = table.findMany({
      where: { AND: [{ deletedAt: null, lastActiveAt: null, adminKey: { gt: pageCursor.adminKey } }, search] },
      orderBy,
      take: take + 1,
    });
  } else {
    rowsPromise = table.findMany({
      where: { deletedAt: null, ...search },
      skip: (Math.max(1, Math.floor(Number(options.page) || 1)) - 1) * take,
      orderBy,
      take: take + 1,
    });
  }
  const [highWater, rows] = await Promise.all([highWaterPromise, rowsPromise]);
  const page = rows.slice(0, take);
  const last = page[page.length - 1];
  return {
    items: page.map(mapSummaryRow),
    summaryCursor: highWater
      ? encodeAdminSummaryCursor({ updatedAt: new Date(highWater.updatedAt), adminKey: String(highWater.adminKey) })
      : null,
    nextPageCursor: rows.length > take && last
      ? encodeAdminSummaryPageCursor({
          lastActiveAt: last.lastActiveAt ? new Date(last.lastActiveAt) : null,
          adminKey: String(last.adminKey),
        })
      : null,
    hasMore: rows.length > take,
  };
}

export async function getAdminUserSummaryChanges(input: {
  cursor?: string | null;
  since?: string | null;
  limit?: number;
}): Promise<{
  items: AdminUserSummaryItem[];
  deletedAdminKeys: string[];
  nextCursor: string;
  hasMore: boolean;
}> {
  const take = Math.max(1, Math.min(500, Math.floor(Number(input.limit) || 100)));
  let cursor: AdminSummaryCursor;
  if (input.cursor) {
    cursor = decodeAdminSummaryCursor(input.cursor);
  } else if (input.since) {
    const updatedAt = new Date(input.since);
    if (Number.isNaN(updatedAt.getTime())) throw new Error("invalid summary cursor");
    cursor = { updatedAt, adminKey: "" };
  } else {
    cursor = { updatedAt: new Date(0), adminKey: "" };
  }
  const table = (prisma as any).adminUserSummary;
  const orderBy = [{ updatedAt: "asc" }, { adminKey: "asc" }];
  const rows = (await Promise.all([
    table.findMany({
      where: { updatedAt: cursor.updatedAt, adminKey: { gt: cursor.adminKey } },
      orderBy,
      take: take + 1,
    }),
    table.findMany({
      where: { updatedAt: { gt: cursor.updatedAt } },
      orderBy,
      take: take + 1,
    }),
  ])).flat().sort(compareSummaryChangeRows).slice(0, take + 1);
  const page = rows.slice(0, take);
  const last = page[page.length - 1];
  const next = last
    ? { updatedAt: new Date(last.updatedAt), adminKey: String(last.adminKey) }
    : cursor;
  return {
    items: page.filter((row: any) => !row.deletedAt).map(mapSummaryRow),
    deletedAdminKeys: page
      .filter((row: any) => Boolean(row.deletedAt))
      .map((row: any) => String(row.adminKey)),
    nextCursor: encodeAdminSummaryCursor(next),
    hasMore: rows.length > take,
  };
}
