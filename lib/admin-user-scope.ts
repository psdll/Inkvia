import prisma from "@/lib/prisma";

type NullableDate = Date | string | null | undefined;

export type AdminUserSummary = {
  adminKey: string;
  userId: string;
  username: string | null;
  generationCount: number;
  lastCreatedAt: string | null;
  // 用户范围内 Generation 的最大 updatedAt（无值回退 createdAt）。
  // summary-changes 用它判断"自 since 以来是否有变化"，能反映 success/failed 状态变更，而非只看新建。
  summaryUpdatedAt: string | null;
  authUserId: number | null;
  linkedUserIds: string[];
  deviceCount: number;
};

export type AdminUserScope = {
  requestedUserId: string;
  authUserId: number | null;
  linkedUserIds: string[];
  linkedGuestUserIds: string[];
  presetUserIds: string[];
  generationWhere: Record<string, unknown>;
  logWhere: Record<string, unknown>;
};

function toIso(value: NullableDate) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function pickLater(a: NullableDate, b: NullableDate) {
  const av = toIso(a);
  const bv = toIso(b);
  if (!av) return bv;
  if (!bv) return av;
  return av > bv ? av : bv;
}

export async function listAdminUserSummaries(extraUserIds: string[] = []): Promise<AdminUserSummary[]> {
  const normalizedExtraUserIds = Array.from(
    new Set(extraUserIds.map((value) => String(value || "").trim()).filter(Boolean))
  );
  const extraAuthIds = normalizedExtraUserIds
    .map((value) => (/^\d+$/.test(value) ? Number(value) : null))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);

  const [authStats, guestStats, authLinks, registeredUsers] = await Promise.all([
    prisma.generation.groupBy({
      by: ["authUserId"],
      where: { authUserId: { not: null } },
      _count: { _all: true },
      _max: { createdAt: true, updatedAt: true }
    }).catch(() => []),
    prisma.generation.groupBy({
      by: ["userId"],
      where: { authUserId: null },
      _count: { _all: true },
      _max: { createdAt: true, updatedAt: true }
    }).catch(() => []),
    prisma.generation.groupBy({
      by: ["authUserId", "userId"],
      where: { authUserId: { not: null } }
    }).catch(() => []),
    prisma.user.findMany({
      select: { id: true, username: true, createdAt: true }
    }).catch(() => [])
  ]);

  const authIds = Array.from(
    new Set(
      [
        ...registeredUsers.map((user) => user.id),
        ...authStats.map((row) => (typeof row.authUserId === "number" ? row.authUserId : null)),
        ...extraAuthIds
      ]
        .filter((value): value is number => value != null)
    )
  );

  const registeredUserById = new Map(registeredUsers.map((user) => [user.id, user] as const));
  const missingAuthIds = authIds.filter((id) => !registeredUserById.has(id));
  const missingAuthUsers = missingAuthIds.length
    ? await prisma.user.findMany({
        where: { id: { in: missingAuthIds } },
        select: { id: true, username: true, createdAt: true }
      }).catch(() => [])
    : [];
  const authUsers = [...registeredUsers, ...missingAuthUsers];

  const usernameById = new Map(authUsers.map((user) => [user.id, user.username] as const));
  const createdAtById = new Map(authUsers.map((user) => [user.id, user.createdAt] as const));
  const guestByUserId = new Map(
    guestStats
      .map((row) => [row.userId, row] as const)
      .filter((entry) => Boolean(entry[0]))
  );

  const linkedUserIdsByAuthId = new Map<number, string[]>();
  for (const row of authLinks) {
    if (typeof row.authUserId !== "number") continue;
    const userId = String(row.userId || "").trim();
    if (!userId) continue;
    const prev = linkedUserIdsByAuthId.get(row.authUserId) || [];
    if (!prev.includes(userId)) prev.push(userId);
    linkedUserIdsByAuthId.set(row.authUserId, prev);
  }

  for (const userId of normalizedExtraUserIds) {
    const mapping = authLinks.find((row) => String(row.userId || "").trim() === userId);
    if (!mapping || typeof mapping.authUserId !== "number") continue;
    const prev = linkedUserIdsByAuthId.get(mapping.authUserId) || [];
    if (!prev.includes(userId)) prev.push(userId);
    linkedUserIdsByAuthId.set(mapping.authUserId, prev);
  }

  const consumedGuestIds = new Set<string>();
  const items: AdminUserSummary[] = [];
  const authStatsById = new Map(
    authStats
      .map((row) => [typeof row.authUserId === "number" ? row.authUserId : null, row] as const)
      .filter((entry): entry is [number, (typeof authStats)[number]] => entry[0] != null)
  );

  for (const authUserId of authIds) {
    const row = authStatsById.get(authUserId);
    const linkedUserIds = Array.from(new Set(linkedUserIdsByAuthId.get(authUserId) || [String(authUserId)])).sort((a, b) =>
      a.localeCompare(b)
    );
    linkedUserIds.forEach((userId) => consumedGuestIds.add(userId));
    const guestRows = linkedUserIds
      .map((userId) => guestByUserId.get(userId))
      .filter((value): value is (typeof guestStats)[number] => Boolean(value));
    const guestCount = guestRows.reduce((sum, guestRow) => sum + Number(guestRow._count?._all || 0), 0);
    const guestLastCreatedAt = guestRows.reduce<NullableDate>((latest, guestRow) => {
      return pickLater(latest, guestRow._max?.createdAt);
    }, null);
    const lastActivityAt = pickLater(row?._max?.createdAt, guestLastCreatedAt);
    const guestLastUpdatedAt = guestRows.reduce<NullableDate>((latest, guestRow) => {
      return pickLater(latest, guestRow._max?.updatedAt);
    }, null);
    const lastUpdatedAt = pickLater(row?._max?.updatedAt, guestLastUpdatedAt);
    const lastCreatedAt = lastActivityAt || toIso(createdAtById.get(authUserId));
    items.push({
      adminKey: `auth:${authUserId}`,
      userId: String(authUserId),
      username: usernameById.get(authUserId) ?? null,
      generationCount: Number(row?._count?._all || 0) + guestCount,
      lastCreatedAt,
      summaryUpdatedAt: lastUpdatedAt || lastCreatedAt,
      authUserId,
      linkedUserIds,
      deviceCount: linkedUserIds.length || 1
    });
  }

  for (const row of guestStats) {
    const userId = String(row.userId || "").trim();
    if (!userId || consumedGuestIds.has(userId)) continue;
    items.push({
      adminKey: `guest:${userId}`,
      userId,
      username: null,
      generationCount: Number(row._count?._all || 0),
      lastCreatedAt: toIso(row._max?.createdAt),
      summaryUpdatedAt: toIso(row._max?.updatedAt) || toIso(row._max?.createdAt),
      authUserId: null,
      linkedUserIds: [userId],
      deviceCount: 1
    });
  }

  for (const userId of normalizedExtraUserIds) {
    const exists = items.some((item) => item.linkedUserIds.includes(userId));
    if (exists) continue;
    items.push({
      adminKey: `guest:${userId}`,
      userId,
      username: null,
      generationCount: 0,
      lastCreatedAt: null,
      summaryUpdatedAt: null,
      authUserId: null,
      linkedUserIds: [userId],
      deviceCount: 1
    });
  }

  return items.sort((a, b) => {
    const diff = new Date(b.lastCreatedAt || 0).getTime() - new Date(a.lastCreatedAt || 0).getTime();
    if (diff !== 0) return diff;
    return a.userId.localeCompare(b.userId);
  });
}

// ── 用户摘要快照缓存（AppSetting） ────────────────────────────────────────────
// listAdminUserSummaries 每次跑 2 个全表 groupBy + 1 个 distinct 全扫，而 /api/admin/users
// 与 summary-changes（后者 3s 轮询）都依赖它。这里用 AppSetting 存 15s 快照 + 进程内单飞 +
// stale-while-revalidate：把全表聚合频率从 ~20 次/分压到 ~4 次/分；冷启动外没有任何一次请求
// 会卡在 groupBy 上。注意：单飞是进程内的，当前单进程 runner 足够；多 worker 部署需改 DB 级守卫。
const ADMIN_USER_SUMMARY_SNAPSHOT_KEY = "admin_user_summaries_snapshot";
const ADMIN_USER_SUMMARY_TTL_MS = 15 * 1000;

type AdminUserSummarySnapshot = { items: AdminUserSummary[]; generatedAt: number };

let summaryRefreshInFlight: Promise<AdminUserSummary[]> | null = null;

async function readSummarySnapshot(): Promise<AdminUserSummarySnapshot | null> {
  try {
    const row = await prisma.appSetting.findUnique({ where: { key: ADMIN_USER_SUMMARY_SNAPSHOT_KEY } });
    if (!row?.value) return null;
    const parsed = JSON.parse(row.value) as AdminUserSummarySnapshot | null;
    if (!parsed || !Array.isArray(parsed.items) || typeof parsed.generatedAt !== "number") return null;
    return parsed;
  } catch {
    return null;
  }
}

function refreshSummarySnapshot(): Promise<AdminUserSummary[]> {
  if (!summaryRefreshInFlight) {
    summaryRefreshInFlight = listAdminUserSummaries([])
      .then(async (items) => {
        const payload = JSON.stringify({ items, generatedAt: Date.now() } as AdminUserSummarySnapshot);
        await prisma.appSetting
          .upsert({
            where: { key: ADMIN_USER_SUMMARY_SNAPSHOT_KEY },
            create: { key: ADMIN_USER_SUMMARY_SNAPSHOT_KEY, value: payload },
            update: { value: payload },
          })
          .catch(() => {});
        return items;
      })
      .finally(() => {
        summaryRefreshInFlight = null;
      });
  }
  return summaryRefreshInFlight;
}

// 把 preset 目录里、还没出现在摘要中的 userId 补成 0 产出的游客条目（沿用旧 tail 合并逻辑）。
function mergeExtraUserIds(items: AdminUserSummary[], extraUserIds: string[]): AdminUserSummary[] {
  const normalized = Array.from(new Set(extraUserIds.map((v) => String(v || "").trim()).filter(Boolean)));
  if (!normalized.length) return items;
  const result = items.slice();
  let added = false;
  for (const userId of normalized) {
    if (result.some((item) => item.linkedUserIds.includes(userId))) continue;
    result.push({
      adminKey: `guest:${userId}`,
      userId,
      username: null,
      generationCount: 0,
      lastCreatedAt: null,
      summaryUpdatedAt: null,
      authUserId: null,
      linkedUserIds: [userId],
      deviceCount: 1,
    });
    added = true;
  }
  if (!added) return items;
  return result.sort((a, b) => {
    const diff = new Date(b.lastCreatedAt || 0).getTime() - new Date(a.lastCreatedAt || 0).getTime();
    if (diff !== 0) return diff;
    return a.userId.localeCompare(b.userId);
  });
}

export type CachedAdminUserSummaries = { items: AdminUserSummary[]; stale: boolean; generatedAt: number | null };

export async function getCachedAdminUserSummaries(extraUserIds: string[] = []): Promise<CachedAdminUserSummaries> {
  const snapshot = await readSummarySnapshot();
  const now = Date.now();
  if (snapshot && now - snapshot.generatedAt < ADMIN_USER_SUMMARY_TTL_MS) {
    return { items: mergeExtraUserIds(snapshot.items, extraUserIds), stale: false, generatedAt: snapshot.generatedAt };
  }
  if (snapshot) {
    // 有旧快照但过期：立即返回旧的 + 后台异步刷新，本次请求不阻塞（关键，3s 轮询不卡）。
    void refreshSummarySnapshot().catch(() => {});
    return { items: mergeExtraUserIds(snapshot.items, extraUserIds), stale: true, generatedAt: snapshot.generatedAt };
  }
  // 冷启动：无快照，只能同步算一次（单飞保证并发请求只触发一次 groupBy）。
  const items = await refreshSummarySnapshot();
  return { items: mergeExtraUserIds(items, extraUserIds), stale: false, generatedAt: now };
}

// 用户删除 / 清理数据后调用，强制下次请求重算快照。
export async function invalidateAdminUserSummariesCache(): Promise<void> {
  summaryRefreshInFlight = null;
  await prisma.appSetting.delete({ where: { key: ADMIN_USER_SUMMARY_SNAPSHOT_KEY } }).catch(() => {});
}

export async function resolveAdminUserScope(
  userId: string,
  authUserIdHint?: number | null,
  options: { explicitIdentity?: boolean } = {},
): Promise<AdminUserScope> {
  const requestedUserId = String(userId || "").trim();
  const hintedAuthUserId = typeof authUserIdHint === "number" && Number.isSafeInteger(authUserIdHint) && authUserIdHint > 0
    ? authUserIdHint
    : null;
  const requestedAuthUserId = options.explicitIdentity
    ? null
    : /^\d+$/.test(requestedUserId) && Number.isFinite(Number(requestedUserId))
      ? Number(requestedUserId)
      : null;
  const mappingRows =
    hintedAuthUserId == null && requestedAuthUserId == null
      ? await prisma.generation.groupBy({
          by: ["authUserId", "userId"],
          where: { userId: requestedUserId, authUserId: { not: null } },
          orderBy: { authUserId: "asc" },
          take: 2
        }).catch(() => [])
      : [];
  const mappedAuthUserId = !options.explicitIdentity
    && mappingRows.length === 1
    && typeof mappingRows[0]?.authUserId === "number"
    ? mappingRows[0].authUserId
    : null;

  const authUserId =
    hintedAuthUserId ?? requestedAuthUserId ?? mappedAuthUserId;
  if (authUserId == null) {
    const unauthenticatedWhere = { authUserId: null, userId: requestedUserId };
    return {
      requestedUserId,
      authUserId: null,
      linkedUserIds: [requestedUserId],
      linkedGuestUserIds: [requestedUserId],
      presetUserIds: [requestedUserId],
      generationWhere: unauthenticatedWhere,
      logWhere: mappingRows.length === 0 ? { userId: requestedUserId } : { userId: { in: [] } }
    };
  }

  const linkedRows = await prisma.generation.groupBy({
    by: ["userId"],
    where: { authUserId }
  }).catch(() => []);

  const linkedUserIds = Array.from(
    new Set(
      [requestedUserId, ...linkedRows.map((row) => String(row.userId || "").trim())].filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b));
  const identityRows = await prisma.generation.groupBy({
    by: ["userId", "authUserId"],
    where: { userId: { in: linkedUserIds }, authUserId: { not: null } },
  }).catch(() => []);
  const linkedAuthIds = new Map<string, Set<number>>();
  for (const row of identityRows) {
    if (typeof row.authUserId !== "number") continue;
    const linkedUserId = String(row.userId || "").trim();
    if (!linkedUserId) continue;
    const authIds = linkedAuthIds.get(linkedUserId) || new Set<number>();
    authIds.add(row.authUserId);
    linkedAuthIds.set(linkedUserId, authIds);
  }
  const linkedGuestUserIds = linkedUserIds.filter((linkedUserId) => {
    const authIds = linkedAuthIds.get(linkedUserId);
    return authIds?.size === 1 && authIds.has(authUserId);
  });

  return {
    requestedUserId,
    authUserId,
    linkedUserIds,
    linkedGuestUserIds,
    // 预设按当前登录账号维度存储，管理员查看用户预设时应读取该账号目录，
    // 而不是混入历史设备/游客 userId 目录，避免出现“只看到部分预设”。
    presetUserIds: [String(authUserId)],
    generationWhere: {
      OR: [
        { authUserId },
        { authUserId: null, userId: { in: linkedGuestUserIds } }
      ]
    },
    logWhere: { userId: { in: linkedGuestUserIds } }
  };
}
