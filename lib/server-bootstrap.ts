import { registerCreativeAgentWake } from "@/lib/creative-agent/worker-wake";
// 单进程后台任务调度。仅在 Node.js 运行时启动一次（由 instrumentation.ts 调用）。
//
// 任务设计原则:
//   - 全部任务串行 try/catch，互不影响
//   - 任务体只读+写自己的缓存表/聚合表，绝不阻塞业务请求
//   - 进程退出时不需要 graceful — 重启后 next interval 会重跑
//
// 涉及的三类任务:
//   1. storage_disk_scan       — 磁盘体积扫描结果写入 AppSetting (TTL 默认 5 分钟)
//   2. usage_ledger_backfill   — UsageLedger 增量补齐 (从 admin/billing GET 移过来)
//   3. analytics_rollup_daily  — AnalyticsDailyByUser 每小时滚动重算最近 31 天

import prisma from "@/lib/prisma";
import { adminWeekday } from "@/lib/admin-analytics-time";
import { backgroundJobsAllowed } from "@/lib/maintenance";

const SCAN_INTERVAL_MS = 5 * 60 * 1000;       // 5 min
const BACKFILL_INTERVAL_MS = 15 * 60 * 1000;  // 15 min
const ROLLUP_INTERVAL_MS = 60 * 60 * 1000;    // hourly due-check; calibration itself is daily/weekly
const EXPORT_MAINTENANCE_INTERVAL_MS = 10 * 60 * 1000; // 10 min
const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const FINALIZE_TICK_MS = 2 * 1000;            // 生成任务收尾轮询
const FINALIZE_RECOVERY_INTERVAL_MS = 60 * 1000; // 卡死 processing 回收
const ADMIN_EVENT_INTERVAL_MS = 2 * 1000;      // 管理员读模型事件消费
const AGENT_WORKER_INTERVAL_MS = 2 * 1000;     // Agent 持久化运行队列
const READ_MODEL_DIFF_INTERVAL_MS = 60 * 60 * 1000;
const BACKGROUND_BOOTSTRAP_RETRY_MS = 2 * 1000;

let started = false;
let adminEventHeartbeatWrittenAt = 0;
let readModelDiffCheckRunning = false;
let readModelDiffRetryMs = 0;
let agentWorkerTickRunning = false;

export function startBackgroundJobs() {
  if (started) return;
  if (!backgroundJobsAllowed()) {
    setTimeout(() => void startBackgroundJobs(), BACKGROUND_BOOTSTRAP_RETRY_MS);
    return;
  }
  started = true;
  // 错开首次执行，避免启动峰值
  setTimeout(() => void runStorageScan(), 5_000);
  setTimeout(() => void runUsageBackfill(), 20_000);
  setTimeout(() => void runAnalyticsRollup(), 35_000);
  setTimeout(() => void runExportMaintenance(), 90_000);
  setTimeout(() => void runDataRetention(), 120_000);
  setTimeout(() => void runGenerationFinalizeRecovery(), 10_000);
  setTimeout(() => void runAdminEventWorker(), 15_000);
  setTimeout(() => void runAdminReadModelDiffCheck(), 25_000);
  setTimeout(() => void runAgentWorkerTick(), 18_000);

  setInterval(() => void runStorageScan(), SCAN_INTERVAL_MS);
  setInterval(() => void runUsageBackfill(), BACKFILL_INTERVAL_MS);
  setInterval(() => void runAnalyticsRollup(), ROLLUP_INTERVAL_MS);
  setInterval(() => void runExportMaintenance(), EXPORT_MAINTENANCE_INTERVAL_MS);
  setInterval(() => void runDataRetention(), RETENTION_INTERVAL_MS);
  setInterval(() => void runGenerationFinalizeTick(), FINALIZE_TICK_MS);
  setInterval(() => void runGenerationFinalizeRecovery(), FINALIZE_RECOVERY_INTERVAL_MS);
  setInterval(() => void runAdminEventWorker(), ADMIN_EVENT_INTERVAL_MS);
  setInterval(() => void runAdminReadModelDiffCheck(), READ_MODEL_DIFF_INTERVAL_MS);
  registerCreativeAgentWake(runAgentWorkerTick);
  setInterval(() => void runAgentWorkerTick(), AGENT_WORKER_INTERVAL_MS);

  console.log("[bg] background jobs scheduled (storage / billing-backfill / analytics-rollup / export-maintenance / retention / generation-finalize / admin-events / agent-worker)");
}

async function runAgentWorkerTick() {
  if (agentWorkerTickRunning) return;
  agentWorkerTickRunning = true;
  try {
    const { runCreativeAgentWorkerTick: tick } = await import("@/lib/creative-agent/worker");
    const result = await tick();
    if (result.failed > 0) {
      console.warn(`[bg] agent worker failed runs: ${result.failed}/${result.claimed}`);
    }
  } catch (e) {
    console.warn("[bg] agent worker tick failed:", (e as Error)?.message || e);
  } finally {
    agentWorkerTickRunning = false;
  }
}

async function runDataRetention() {
  try {
    const { pruneLogsIfNeeded } = await import("@/lib/log-retention");
    await pruneLogsIfNeeded();
  } catch (e) {
    console.warn("[bg] data retention failed:", (e as Error)?.message || e);
  }
}

async function runAdminReadModelDiffCheck() {
  if (readModelDiffCheckRunning) return;
  readModelDiffCheckRunning = true;
  try {
    const { measureAdminReadModelDiff, measureAdminUserSummaryDiff } = await import("@/lib/admin-analytics-rollup");
    const result = await prisma.$transaction(async (tx: any) => {
      const lease = await tx.$queryRawUnsafe(
        `SELECT pg_try_advisory_xact_lock(hashtextextended('admin-read-model-diff-check', 0)) AS acquired`,
      );
      if (!lease?.[0]?.acquired) return null;
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '5min'`);
      const works = await measureAdminReadModelDiff(tx);
      const summaries = await measureAdminUserSummaryDiff(tx);
      return { works, summaries };
    }, { maxWait: 5_000, timeout: 6 * 60_000 });
    if (!result) return;
    const { works, summaries } = result;
    if (works.count > 0 || summaries.count > 0) {
      console.warn(`[bg] admin read model differences: works=${works.count} summaries=${summaries.count}`);
      readModelDiffRetryMs = Math.min(readModelDiffRetryMs ? readModelDiffRetryMs * 2 : 15_000, 15 * 60_000);
      setTimeout(() => void runAdminReadModelDiffCheck(), readModelDiffRetryMs);
    } else {
      readModelDiffRetryMs = 0;
    }
  } catch (e) {
    console.warn("[bg] admin read model consistency check failed:", (e as Error)?.message || e);
    readModelDiffRetryMs = Math.min(readModelDiffRetryMs ? readModelDiffRetryMs * 2 : 15_000, 15 * 60_000);
    setTimeout(() => void runAdminReadModelDiffCheck(), readModelDiffRetryMs);
  } finally {
    readModelDiffCheckRunning = false;
  }
}

async function runAdminEventWorker() {
  try {
    const { processAdminEvents, processMediaCleanupRetryEvents } = await import("@/lib/admin-operational");
    const result = await processAdminEvents(100);
    const mediaCleanup = await processMediaCleanupRetryEvents(25);
    if (result.failed > 0) console.warn(`[bg] admin events failed: ${result.failed}/${result.claimed}`);
    if (mediaCleanup.failed > 0) console.warn(`[bg] media cleanup retries failed: ${mediaCleanup.failed}/${mediaCleanup.claimed}`);
    if (result.leaseAcquired && Date.now() - adminEventHeartbeatWrittenAt >= 10_000) {
      const successAt = new Date().toISOString();
      await prisma.appSetting.upsert({
        where: { key: "admin_event_worker_heartbeat" },
        create: { key: "admin_event_worker_heartbeat", value: JSON.stringify({ successAt, ...result, mediaCleanup }) },
        update: { value: JSON.stringify({ successAt, ...result, mediaCleanup }) },
      });
      adminEventHeartbeatWrittenAt = Date.now();
    }
  } catch (e) {
    console.warn("[bg] admin event worker failed:", (e as Error)?.message || e);
  }
}

// ── 生成任务收尾 worker ─────────────────────────────────────────────────────────
// 把"查 provider → 下载保存 → 去重 → 计费"从 /api/history 请求链路移到后台。
// 保存逻辑统一在 lib/generation/finalize.ts（幂等 + DB claim），这里只负责调度：
//   - 每 2s 扫一次进行中的任务，按 createdAt 升序最多取 10 条
//   - 创建 60s 内的任务每 tick 都查（provider 通常几十秒完成），之后退避到 ~10s
//   - 并发上限 3，避免多个大文件下载打满磁盘/带宽
//   - in-flight 防护：上一轮没跑完不开新轮

const FINALIZE_CONCURRENCY = 3;

let finalizeTickRunning = false;

async function runGenerationFinalizeTick() {
  if (finalizeTickRunning) return;
  finalizeTickRunning = true;
  try {
    const { finalizeGeneration, FINALIZE_PROVIDERS, FINALIZE_IN_PROGRESS_STATUSES } = await import("@/lib/generation/finalize");
    const { buildGenerationFinalizeCandidateQuery } = await import("@/lib/generation/finalize-scheduler");
    const due = await prisma.generation.findMany(buildGenerationFinalizeCandidateQuery(new Date(), {
      providers: FINALIZE_PROVIDERS,
      statuses: FINALIZE_IN_PROGRESS_STATUSES,
      take: 10,
    }) as any);

    if (!due.length) return;

    let cursor = 0;
    await Promise.all(
      Array.from({ length: Math.min(FINALIZE_CONCURRENCY, due.length) }, async () => {
        while (cursor < due.length) {
          const item = due[cursor++];
          try {
            await finalizeGeneration(item.id);
          } catch (e) {
            console.warn(`[bg] finalize generation ${item.id} failed:`, (e as Error)?.message || e);
          }
        }
      })
    );
  } catch (e) {
    console.warn("[bg] generation finalize tick failed:", (e as Error)?.message || e);
  } finally {
    finalizeTickRunning = false;
  }
}

async function runGenerationFinalizeRecovery() {
  try {
    const {
      finalizeGeneration,
      recoverStaleProcessing,
      FINALIZE_IN_PROGRESS_STATUSES,
      FINALIZE_MAX_AGE_MS,
      IMAGE_EDIT_FINALIZE_MAX_AGE_MS,
    } = await import("@/lib/generation/finalize");
    const { buildGenerationStaleCandidateQuery } = await import("@/lib/generation/finalize-scheduler");
    await recoverStaleProcessing();
    const stale = await prisma.generation.findMany(buildGenerationStaleCandidateQuery(new Date(), {
      statuses: FINALIZE_IN_PROGRESS_STATUSES,
      imageMaxAgeMs: IMAGE_EDIT_FINALIZE_MAX_AGE_MS,
      defaultMaxAgeMs: FINALIZE_MAX_AGE_MS,
      take: 50,
    }) as any);
    for (const item of stale) {
      try {
        await finalizeGeneration(item.id);
      } catch (e) {
        console.warn(`[bg] stale generation ${item.id} finalization failed:`, (e as Error)?.message || e);
      }
    }
  } catch (e) {
    console.warn("[bg] generation finalize recovery failed:", (e as Error)?.message || e);
  }
}

// ── Storage 体积扫描缓存 ─────────────────────────────────────────────────────────
// admin/storage GET 不再亲自走文件系统，读 AppSetting 中的快照即可。

export const STORAGE_SCAN_KEY = "admin_storage_scan_snapshot";

async function runStorageScan() {
  try {
    const { scanStorageCategories } = await import("@/lib/admin-storage-scan");
    const snapshot = await scanStorageCategories();
    await prisma.appSetting.upsert({
      where: { key: STORAGE_SCAN_KEY },
      create: { key: STORAGE_SCAN_KEY, value: JSON.stringify(snapshot) },
      update: { value: JSON.stringify(snapshot) },
    });
  } catch (e) {
    console.warn("[bg] storage scan failed:", (e as Error)?.message || e);
  }
}

// ── UsageLedger 增量补齐 ────────────────────────────────────────────────────────
// 原来在 admin/billing GET 里同步跑，每次请求扫最多 2000 行还要写入 — 改成异步定时。

async function runUsageBackfill() {
  try {
    const { backfillUsageLedgersForGenerations } = await import("@/lib/billing-ledger");
    const result = await backfillUsageLedgersForGenerations({}, 2000);
    if (result?.synced) {
      console.log(`[bg] usage ledger backfill: scanned=${result.scanned} synced=${result.synced}`);
    }
  } catch (e) {
    console.warn("[bg] usage backfill failed:", (e as Error)?.message || e);
  }
}

// ── 日聚合滚动 ────────────────────────────────────────────────────────────────
// AnalyticsDailyByUser：admin 概览 / 数据分析读这张表，不再扫 Generation。

async function runAnalyticsRollup() {
  try {
    const { rebuildRecentDailyAnalytics } = await import("@/lib/admin-analytics-rollup");
    const now = new Date();
    const [dailyMarker, weeklyMarker, summaryDiffMarker] = await Promise.all([
      prisma.appSetting.findUnique({ where: { key: "admin_analytics_daily_reconciled_at" } }),
      prisma.appSetting.findUnique({ where: { key: "admin_analytics_weekly_reconciled_at" } }),
      prisma.appSetting.findUnique({ where: { key: "admin_user_summary_read_model_diff" } }),
    ]);
    const dailyAt = dailyMarker?.value ? new Date(dailyMarker.value).getTime() : 0;
    const weeklyAt = weeklyMarker?.value ? new Date(weeklyMarker.value).getTime() : 0;
    let summaryReady = false;
    try {
      summaryReady = JSON.parse(String(summaryDiffMarker?.value || "")).count === 0;
    } catch {}
    const initialSummaryDue = !summaryReady;
    const weeklyDue = adminWeekday(now) === 0 && now.getTime() - weeklyAt >= 6 * 24 * 60 * 60 * 1000;
    const dailyDue = now.getTime() - dailyAt >= 20 * 60 * 60 * 1000;
    if (!initialSummaryDue && !weeklyDue && !dailyDue) return;
    const result = await rebuildRecentDailyAnalytics(initialSummaryDue || weeklyDue ? "all" : 3);
    if (!result.leaseAcquired) return;
    const value = now.toISOString();
    await prisma.appSetting.upsert({
      where: { key: "admin_analytics_daily_reconciled_at" },
      create: { key: "admin_analytics_daily_reconciled_at", value },
      update: { value },
    });
    if (weeklyDue) {
      await prisma.appSetting.upsert({
        where: { key: "admin_analytics_weekly_reconciled_at" },
        create: { key: "admin_analytics_weekly_reconciled_at", value },
        update: { value },
      });
    }
  } catch (e) {
    console.warn("[bg] analytics rollup failed:", (e as Error)?.message || e);
  }
}

// ── 用户导出任务维护 ────────────────────────────────────────────────────────────
// 清理过期的导出 ZIP 临时文件 + 捞起卡死的 running 任务。
async function runExportMaintenance() {
  try {
    const { runUserExportMaintenance } = await import("@/lib/admin/user-export-maintenance");
    await runUserExportMaintenance();
  } catch (e) {
    console.warn("[bg] export maintenance failed:", (e as Error)?.message || e);
  }
}
