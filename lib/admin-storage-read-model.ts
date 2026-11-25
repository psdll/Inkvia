import prisma from "@/lib/prisma";
import { loadAdminModelUsageRows } from "@/lib/admin/model-call-source";
import { adminDayKey, adminStartOfDay } from "@/lib/admin-analytics-time";
import {
  readRollupForLastNDays,
  type RollupReadout,
} from "@/lib/admin-analytics-rollup";

type SummaryRow = {
  adminKey: string;
  userId: string;
  authUserId: number | null;
  username: string | null;
  totalTaskCount: number;
  assetCount: number;
  storageBytes: bigint | number;
  lastActiveAt: Date | string | null;
};

type BuildInput = {
  days: number;
  totalBytes: number;
  summaries: SummaryRow[];
  rollup: RollupReadout;
  modelUsageRows?: ModelUsageRow[];
  behaviorRows?: BehaviorRow[];
  failureRows?: FailureRow[];
  privateMediaRows?: PrivateMediaRow[];
  typeStorageRows?: TypeStorageRow[];
  unknownStorageCount?: number;
};

type ModelUsageRow = {
  day: string;
  authUserId: number | null;
  userId: string | null;
  model: string;
  requestCount: number;
  successCount: number;
  failedCount: number;
};

type BehaviorRow = {
  category: string;
  action: string;
  createdAt: Date | string;
};

type FailureRow = {
  type: string;
  errorMsg: string | null;
};

type PrivateMediaRow = {
  ownerUserId: number;
  kind: string;
  count: number;
  storageBytes: number;
};

type TypeStorageRow = {
  type: string;
  storageBytes: number;
};

type AnalyticsType = "image" | "video" | "face" | "other";

type DailyBehavior = {
  upload: number;
  submit: number;
  success: number;
  failed: number;
  download: number;
  delete: number;
  feedbackSubmit: number;
};

const outputCount = (value: {
  imageCount: number;
  videoCount: number;
  faceCount: number;
  otherCount: number;
}) => value.imageCount + value.videoCount + value.faceCount + value.otherCount;

const safeRatio = (value: number, total: number) => total > 0 ? value / total : 0;

const analyticsType = (value: string): AnalyticsType => {
  const type = String(value || "").toLowerCase();
  if (type.includes("video")) return "video";
  if (type.includes("face")) return "face";
  if (type.includes("image")) return "image";
  return "other";
};

const normalizeFailureReason = (value: string | null) => {
  const cleaned = String(value || "")
    .trim()
    .replace(/^错误:\s*/i, "")
    .replace(/^error:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return (cleaned || "未知原因").slice(0, 64);
};

const toIso = (value: Date | string | null) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export function buildAdminStorageAnalytics({
  days,
  totalBytes,
  summaries,
  rollup,
  modelUsageRows = [],
  behaviorRows = [],
  failureRows = [],
  privateMediaRows = [],
  typeStorageRows = [],
  unknownStorageCount = 0,
}: BuildInput) {
  const summaryByKey = new Map(summaries.map((row) => [row.adminKey, row] as const));
  const rollupByKey = new Map(rollup.perUser.map((row) => [
    row.authUserId == null ? `guest:${row.userId}` : `auth:${row.authUserId}`,
    row,
  ] as const));
  const privateMediaByKey = new Map<string, { count: number; storageBytes: number }>();
  const storageByType: Record<AnalyticsType, number> = { image: 0, video: 0, face: 0, other: 0 };
  const countByType: Record<AnalyticsType, number> = {
    image: Math.max(0, Number(rollup.totals.imageCount) || 0),
    video: Math.max(0, Number(rollup.totals.videoCount) || 0),
    face: Math.max(0, Number(rollup.totals.faceCount) || 0),
    other: Math.max(0, Number(rollup.totals.otherCount) || 0),
  };
  for (const row of typeStorageRows) {
    const type = analyticsType(row.type);
    storageByType[type] += Math.max(0, Number(row.storageBytes) || 0);
  }
  for (const row of privateMediaRows) {
    const ownerUserId = Math.floor(Number(row.ownerUserId) || 0);
    if (ownerUserId <= 0) continue;
    const adminKey = `auth:${ownerUserId}`;
    const current = privateMediaByKey.get(adminKey) || { count: 0, storageBytes: 0 };
    const count = Math.max(0, Number(row.count) || 0);
    const storageBytes = Math.max(0, Number(row.storageBytes) || 0);
    current.count += count;
    current.storageBytes += storageBytes;
    privateMediaByKey.set(adminKey, current);
    const type = analyticsType(row.kind);
    countByType[type] += count;
    storageByType[type] += storageBytes;
  }
  const allKeys = Array.from(new Set([
    ...summaryByKey.keys(),
    ...rollupByKey.keys(),
    ...privateMediaByKey.keys(),
  ]));
  const recentOutputs = outputCount(rollup.totals);
  const attributedBytes = summaries.reduce(
    (total, row) => total + Math.max(0, Number(row.storageBytes) || 0),
    0,
  ) + Array.from(privateMediaByKey.values()).reduce((total, row) => total + row.storageBytes, 0);
  const coverage = totalBytes > 0 ? Math.min(1, attributedBytes / totalBytes) : 1;
  const complete = coverage >= 0.8;
  const lifetimeGenerations = summaries.reduce(
    (total, row) => total + Math.max(0, Number(row.assetCount) || 0),
    0,
  );
  const settled = rollup.totals.successCount + rollup.totals.failedCount;
  const users = allKeys.map((adminKey) => {
    const summary = summaryByKey.get(adminKey);
    const recent = rollupByKey.get(adminKey);
    const privateMedia = privateMediaByKey.get(adminKey);
    const generationCount = recent ? outputCount(recent) : 0;
    const materialCount = Math.max(0, Number(summary?.assetCount) || 0) + (privateMedia?.count || 0);
    const storageBytes = Math.max(0, Number(summary?.storageBytes) || 0) + (privateMedia?.storageBytes || 0);
    const fallbackUserId = adminKey.replace(/^(?:auth|guest):/, "");
    const userId = String(summary?.userId || recent?.userId || fallbackUserId);
    const authUserId = summary?.authUserId ?? recent?.authUserId ?? null;
    return {
      adminKey,
      userId,
      authUserId,
      username: summary?.username || null,
      generationCount,
      successCount: recent?.successCount || 0,
      failedCount: recent?.failedCount || 0,
      generationShare: safeRatio(generationCount, recentOutputs),
      storageBytes,
      storageShare: complete ? safeRatio(storageBytes, attributedBytes) : 0,
      avgBytesPerGeneration: safeRatio(storageBytes, materialCount),
      materialCount,
      lastCreatedAt: toIso(summary?.lastActiveAt || null),
      typeBreakdown: {
        image: recent?.imageCount || 0,
        video: recent?.videoCount || 0,
        face: recent?.faceCount || 0,
        other: recent?.otherCount || 0,
      },
      trend7: Array.from(recent?.daily.values() || []).slice(-7),
    };
  });
  const sortedOutputs = users.map((item) => item.generationCount).sort((a, b) => b - a);
  const top10Output = sortedOutputs.slice(0, 10).reduce((total, value) => total + value, 0);
  const insights = complete
    ? []
    : [`用户容量归属率仅 ${(coverage * 100).toFixed(1)}%，低于 80%，已隐藏用户容量占比。`];
  const globalModels = new Map<string, { count: number; success: number; failed: number }>();
  const dailyModels = new Map<string, Record<string, number>>();
  const userModels = new Map<string, Map<string, number>>();
  for (const row of modelUsageRows) {
    const model = String(row.model || "unknown");
    const count = Math.max(0, Number(row.requestCount) || 0);
    const global = globalModels.get(model) || { count: 0, success: 0, failed: 0 };
    global.count += count;
    global.success += Math.max(0, Number(row.successCount) || 0);
    global.failed += Math.max(0, Number(row.failedCount) || 0);
    globalModels.set(model, global);
    const day = String(row.day || "");
    const byModel = dailyModels.get(day) || {};
    byModel[model] = (byModel[model] || 0) + count;
    dailyModels.set(day, byModel);
    const adminKey = row.authUserId == null
      ? `guest:${String(row.userId || "unknown")}`
      : `auth:${row.authUserId}`;
    const perUser = userModels.get(adminKey) || new Map<string, number>();
    perUser.set(model, (perUser.get(model) || 0) + count);
    userModels.set(adminKey, perUser);
  }
  const totalModelCalls = Array.from(globalModels.values()).reduce((total, item) => total + item.count, 0);
  const globalModelRatio = Array.from(globalModels.entries())
    .map(([model, item]) => ({ model, count: item.count, ratio: safeRatio(item.count, totalModelCalls) }))
    .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
  const modelOutcomeTop = Array.from(globalModels.entries())
    .map(([model, item]) => ({
      model,
      totalCalls: item.count,
      successCount: item.success,
      failedCount: item.failed,
      successRate: safeRatio(item.success, item.success + item.failed),
      failedRate: safeRatio(item.failed, item.success + item.failed),
    }))
    .sort((a, b) => b.totalCalls - a.totalCalls || a.model.localeCompare(b.model));
  const userModelEntries = Array.from(userModels.entries()).map(([adminKey, byModel]) => {
    const summary = summaryByKey.get(adminKey);
    const cells = Object.fromEntries(byModel.entries());
    const breakdown = Array.from(byModel.entries())
      .map(([model, count]) => ({ model, count, ratio: 0 }))
      .sort((a, b) => b.count - a.count || a.model.localeCompare(b.model));
    const totalCalls = breakdown.reduce((total, item) => total + item.count, 0);
    for (const item of breakdown) item.ratio = safeRatio(item.count, totalCalls);
    const fallbackUserId = adminKey.replace(/^(?:auth|guest):/, "");
    return {
      adminKey,
      userId: String(summary?.userId || fallbackUserId),
      authUserId: summary?.authUserId ?? (adminKey.startsWith("auth:") ? Number(fallbackUserId) : null),
      username: summary?.username || null,
      totalCalls,
      topModel: breakdown[0]?.model || "unknown",
      topModelCount: breakdown[0]?.count || 0,
      topModelRatio: breakdown[0]?.ratio || 0,
      modelBreakdown: breakdown,
      cells,
    };
  }).sort((a, b) => b.totalCalls - a.totalCalls || a.adminKey.localeCompare(b.adminKey));

  const behaviorDays = Array.from({ length: Math.max(1, days) }, (_, index) =>
    adminDayKey(new Date(Date.now() - (Math.max(1, days) - 1 - index) * 24 * 60 * 60 * 1000))
  );
  const behaviorDaySet = new Set(behaviorDays);
  const dailyBehavior = new Map<string, DailyBehavior>(behaviorDays.map((day) => [day, {
    upload: 0,
    submit: 0,
    success: 0,
    failed: 0,
    download: 0,
    delete: 0,
    feedbackSubmit: 0,
  }]));
  for (const row of rollup.daily) {
    const daily = dailyBehavior.get(row.day);
    if (!daily) continue;
    daily.success += Math.max(0, Number(row.successCount) || 0);
    daily.failed += Math.max(0, Number(row.failedCount) || 0);
  }
  let loggedSubmit = 0;
  const loggedSubmitByDay = new Map<string, number>();
  for (const row of behaviorRows) {
    const day = adminDayKey(row.createdAt);
    if (!behaviorDaySet.has(day)) continue;
    const daily = dailyBehavior.get(day);
    if (!daily) continue;
    if (row.category === "generation" && row.action === "task_create") {
      loggedSubmit += 1;
      loggedSubmitByDay.set(day, (loggedSubmitByDay.get(day) || 0) + 1);
    } else if (row.category === "user_action" && row.action === "upload_input") {
      daily.upload += 1;
    } else if (row.category === "user_action" && row.action === "download_output") {
      daily.download += 1;
    } else if (row.category === "user_action" && row.action === "delete_output") {
      daily.delete += 1;
    } else if (row.category === "user_action" && row.action === "feedback_submit") {
      daily.feedbackSubmit += 1;
    }
  }
  for (const [day, daily] of dailyBehavior.entries()) {
    daily.submit = loggedSubmitByDay.get(day) || daily.success + daily.failed;
  }
  const behaviorFunnel = Array.from(dailyBehavior.values()).reduce(
    (total, row) => ({
      upload: total.upload + row.upload,
      submit: total.submit + row.submit,
      success: total.success + row.success,
      failed: total.failed + row.failed,
      download: total.download + row.download,
      delete: total.delete + row.delete,
    }),
    { upload: 0, submit: 0, success: 0, failed: 0, download: 0, delete: 0 },
  );
  if (loggedSubmit > 0) behaviorFunnel.submit = loggedSubmit;

  const failureByTypeMap: Record<AnalyticsType, number> = { image: 0, video: 0, face: 0, other: 0 };
  const failureReasonMap = new Map<string, number>();
  for (const row of failureRows) {
    failureByTypeMap[analyticsType(row.type)] += 1;
    const reason = normalizeFailureReason(row.errorMsg);
    failureReasonMap.set(reason, (failureReasonMap.get(reason) || 0) + 1);
  }
  const failureByType = (Object.keys(failureByTypeMap) as AnalyticsType[]).map((type) => ({
    type,
    count: failureByTypeMap[type],
  }));
  const failureByReasonTop = Array.from(failureReasonMap.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
    .slice(0, 8);

  const userMaterialShareTop = users
    .map((item) => ({
      adminKey: item.adminKey,
      userId: item.userId,
      authUserId: item.authUserId,
      username: item.username,
      bytes: item.storageBytes,
      ratio: safeRatio(item.storageBytes, attributedBytes),
    }))
    .sort((a, b) => b.bytes - a.bytes || a.adminKey.localeCompare(b.adminKey))
    .slice(0, 12);
  const totalMaterialCount = users.reduce((total, item) => total + item.materialCount, 0);
  const userMaterialCountShareTop = users
    .map((item) => ({
      adminKey: item.adminKey,
      userId: item.userId,
      authUserId: item.authUserId,
      username: item.username,
      count: item.materialCount,
      ratio: safeRatio(item.materialCount, totalMaterialCount),
    }))
    .sort((a, b) => b.count - a.count || a.adminKey.localeCompare(b.adminKey))
    .slice(0, 12);
  const materialTotalBytes = Object.values(storageByType).reduce((total, value) => total + value, 0);
  const materialTotalCount = Object.values(countByType).reduce((total, value) => total + value, 0);
  const materialByTypeRatio = (Object.keys(countByType) as AnalyticsType[]).map((type) => ({
    type,
    count: countByType[type],
    countRatio: safeRatio(countByType[type], materialTotalCount),
    bytes: storageByType[type],
    bytesRatio: safeRatio(storageByType[type], materialTotalBytes),
  }));

  const alertItems: Array<{
    level: "info" | "warning" | "critical";
    title: string;
    detail: string;
  }> = [];
  if (!complete) {
    alertItems.push({
      level: "warning",
      title: "用户容量归属率不足",
      detail: insights[0],
    });
  }
  const failureRate = safeRatio(behaviorFunnel.failed, Math.max(1, behaviorFunnel.submit));
  if (behaviorFunnel.failed >= 5 && failureRate >= 0.2) {
    alertItems.push({
      level: "warning",
      title: "近期开启任务失败率偏高",
      detail: `近 ${days} 天提交 ${behaviorFunnel.submit} 次，失败 ${behaviorFunnel.failed} 次（${(failureRate * 100).toFixed(1)}%）`,
    });
  }
  if (globalModelRatio[0]?.ratio >= 0.6) {
    alertItems.push({
      level: "info",
      title: "模型调用集中度较高",
      detail: `模型 ${globalModelRatio[0].model} 调用占比 ${(globalModelRatio[0].ratio * 100).toFixed(1)}%`,
    });
  }

  return {
    capacityOwnership: { attributedBytes, totalBytes, coverage, complete },
    totals: {
      totalUsers: allKeys.length,
      activeUsers: users.filter((item) => item.generationCount > 0).length,
      totalGenerations: recentOutputs,
      lifetimeGenerations,
      successGenerations: rollup.totals.successCount,
      failedGenerations: rollup.totals.failedCount,
      successRate: safeRatio(rollup.totals.successCount, settled),
      avgGenerationPerActiveUser: safeRatio(
        recentOutputs,
        users.filter((item) => item.generationCount > 0).length,
      ),
      top10GenerationShare: safeRatio(top10Output, recentOutputs),
      longTailGenerationShare: safeRatio(Math.max(0, recentOutputs - top10Output), recentOutputs),
      totalUserStorageBytes: attributedBytes,
      unknownStorageCount: Math.max(0, Number(unknownStorageCount) || 0),
    },
    users,
    daily30: rollup.daily.slice(-30).map((row) => ({
      day: row.day,
      generationCount: outputCount(row),
      storageBytes: row.storageBytes,
    })),
    typeDistribution: (Object.keys(countByType) as AnalyticsType[]).map((type) => ({
      type,
      generationCount: type === "image"
        ? rollup.totals.imageCount
        : type === "video"
          ? rollup.totals.videoCount
          : type === "face"
            ? rollup.totals.faceCount
            : rollup.totals.otherCount,
      storageBytes: storageByType[type],
    })),
    insights,
    behavior: {
      days,
      funnel: behaviorFunnel,
      dailyBehavior30: behaviorDays.map((day) => ({ day, ...dailyBehavior.get(day)! })),
      failureByType,
      failureByReasonTop,
      alertItems,
    },
    modelUsage: {
      globalModelRatio,
      modelOutcomeTop,
      modelTrend30: Array.from(dailyModels.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-30)
        .map(([day, models]) => ({ day, models })),
      userModelRatioTop: userModelEntries.map(({ cells: _cells, ...item }) => item),
      userModelMix: userModelEntries.map(({ modelBreakdown: _breakdown, topModel: _topModel, topModelCount: _topModelCount, topModelRatio: _topModelRatio, ...item }) => item),
    },
    userMaterialRatio: {
      userMaterialShareTop,
      userMaterialCountShareTop,
      materialByTypeRatio,
    },
  };
}

export async function loadAdminStorageReadModel(totalBytes: number, days = 90) {
  const modelStart = adminStartOfDay(29);
  const behaviorStart = adminStartOfDay(Math.max(0, days - 1));
  const [
    rollup,
    summaries,
    modelUsageRows,
    behaviorRows,
    failureRows,
    privateMediaAggregates,
    typeStorageAggregates,
    unknownStorageCount,
  ] = await Promise.all([
    readRollupForLastNDays(days),
    (prisma as any).adminUserSummary.findMany({
      where: { deletedAt: null },
      orderBy: [{ lastActiveAt: "desc" }, { adminKey: "asc" }],
      select: {
        adminKey: true,
        userId: true,
        authUserId: true,
        username: true,
        totalTaskCount: true,
        assetCount: true,
        storageBytes: true,
        lastActiveAt: true,
      },
    }) as Promise<SummaryRow[]>,
    loadAdminModelUsageRows(modelStart),
    prisma.log.findMany({
      where: {
        createdAt: { gte: behaviorStart },
        OR: [
          {
            category: "user_action",
            action: { in: ["upload_input", "download_output", "delete_output", "feedback_submit"] },
          },
          { category: "generation", action: "task_create" },
        ],
      },
      select: { category: true, action: true, createdAt: true },
    }).catch(() => [] as BehaviorRow[]),
    (prisma as any).adminWorkFeed.findMany({
      where: { deletedAt: null, status: "failed", createdAt: { gte: behaviorStart } },
      select: { type: true, errorMsg: true },
    }).catch(() => [] as FailureRow[]),
    prisma.mediaLibraryItem.groupBy({
      by: ["ownerUserId", "kind"],
      where: { scope: "private", isDeleted: false, ownerUserId: { not: null } },
      _sum: { sizeBytes: true },
      _count: { _all: true },
    }).catch(() => []),
    (prisma as any).adminWorkFeed.groupBy({
      by: ["type"],
      where: { deletedAt: null, type: { not: "import" }, createdAt: { gte: behaviorStart } },
      _sum: { sizeBytes64: true },
    }).catch(() => []),
    (prisma as any).adminWorkFeed.count({
      where: {
        deletedAt: null,
        status: "success",
        type: { not: "import" },
        OR: [{ sizeBytes64: null }, { sizeBytes64: { lte: BigInt(0) } }],
      },
    }).catch(() => 0),
  ]);
  const privateMediaRows: PrivateMediaRow[] = (privateMediaAggregates as any[]).map((row) => ({
    ownerUserId: Number(row.ownerUserId),
    kind: String(row.kind || "other"),
    count: Math.max(0, Number(row._count?._all) || 0),
    storageBytes: Math.max(0, Number(row._sum?.sizeBytes) || 0),
  }));
  const typeStorageRows: TypeStorageRow[] = (typeStorageAggregates as any[]).map((row) => ({
    type: String(row.type || "other"),
    storageBytes: Math.max(0, Number(row._sum?.sizeBytes64) || 0),
  }));
  const analytics = buildAdminStorageAnalytics({
    days,
    totalBytes,
    summaries,
    rollup,
    modelUsageRows,
    behaviorRows,
    failureRows,
    privateMediaRows,
    typeStorageRows,
    unknownStorageCount,
  });
  const topUsers = [...summaries]
    .sort((a, b) => Number(b.assetCount) - Number(a.assetCount))
    .slice(0, 8)
    .map((row) => ({
      adminKey: row.adminKey,
      userId: row.userId,
      authUserId: row.authUserId,
      username: row.username,
      generationCount: Math.max(0, Number(row.assetCount) || 0),
      lastCreatedAt: toIso(row.lastActiveAt),
    }));
  return { analytics, topUsers };
}
