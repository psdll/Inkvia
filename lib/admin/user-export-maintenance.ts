import fs from "fs-extra";
import prisma from "@/lib/prisma";
import { getExportsDir } from "@/lib/admin/user-export-builder";
import { getImportsDir } from "@/lib/admin/user-transfer-paths";
import { cleanupMigrationScratch } from "@/lib/admin/user-migration-package";

/**
 * 用户导出任务的后台维护：
 *  - 清理过期/已完成超期的 ZIP 临时文件，并把 job 标记为 expired
 *  - 捞起卡死的 running job（进程重启遗留），标记为 error 供前端提示重试
 *
 * 由 lib/server-bootstrap.ts 的定时任务周期性调用。
 */

// running 超过该时长仍未完成，视为卡死（进程被重启等）
const STUCK_RUNNING_MS = 30 * 60 * 1000;

async function safeUnlink(filePath: string | null | undefined) {
  if (!filePath) return;
  try {
    await fs.remove(filePath);
  } catch {
    // 文件不存在或已删，忽略
  }
}

export async function runUserExportMaintenance(): Promise<void> {
  const now = new Date();

  // 1) 过期清理：done 且已过 expiresAt
  const expired = await prisma.userExportJob
    .findMany({
      where: { status: "done", expiresAt: { not: null, lt: now } },
      select: { id: true, filePath: true },
      take: 100,
    })
    .catch(() => [] as { id: string; filePath: string | null }[]);
  for (const job of expired) {
    await safeUnlink(job.filePath);
    await prisma.userExportJob
      .update({
        where: { id: job.id },
        data: { status: "expired", filePath: null, token: null },
      })
      .catch(() => {});
  }

  // 2) 卡死的 running job
  const stuckBefore = new Date(now.getTime() - STUCK_RUNNING_MS);
  const stuck = await prisma.userExportJob
    .findMany({
      where: { status: { in: ["pending", "running"] }, updatedAt: { lt: stuckBefore } },
      select: { id: true, filePath: true },
      take: 100,
    })
    .catch(() => [] as { id: string; filePath: string | null }[]);
  for (const job of stuck) {
    await safeUnlink(job.filePath);
    await prisma.userExportJob
      .update({
        where: { id: job.id },
        data: {
          status: "error",
          error: "打包超时或服务重启导致任务中断，请重试",
          filePath: null,
          token: null,
          finishedAt: now,
        },
      })
      .catch(() => {});
  }

  const expiredImports = await (prisma as any).userImportJob
    .findMany({
      where: {
        OR: [
          { status: "done", expiresAt: { not: null, lt: now } },
          {
            status: { in: ["error", "cancelled"] },
            finishedAt: { not: null, lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) },
          },
        ],
      },
      select: { id: true, filePath: true },
      take: 100,
    })
    .catch(() => [] as { id: string; filePath: string | null }[]);
  for (const job of expiredImports) {
    await safeUnlink(job.filePath);
    await (prisma as any).userImportJob
      .update({ where: { id: job.id }, data: { status: "expired", filePath: null } })
      .catch(() => {});
  }

  const stuckImports = await (prisma as any).userImportJob
    .findMany({
      where: { status: { in: ["pending", "running"] }, updatedAt: { lt: stuckBefore } },
      select: { id: true, filePath: true },
      take: 100,
    })
    .catch(() => [] as { id: string; filePath: string | null }[]);
  for (const job of stuckImports) {
    await (prisma as any).userImportJob
      .update({
        where: { id: job.id },
        data: {
          status: "error",
          error: "导入任务超过 30 分钟没有进度更新，已判定中断；上传文件已保留，可直接重试。",
          finishedAt: now,
        },
      })
      .catch(() => {});
  }

  // A terminated process cannot run finally; remove its aged private scratch only
  // when no transfer is active. If the database check fails, leave files untouched.
  const active = await Promise.all([
    prisma.userExportJob.count({ where: { status: { in: ["pending", "running"] } } }),
    prisma.userImportJob.count({ where: { status: { in: ["pending", "running"] } } }),
  ]).catch(() => null);
  if (active && active.every((count) => count === 0)) {
    await cleanupMigrationScratch(getImportsDir(), now.getTime());
    await cleanupMigrationScratch(getExportsDir(), now.getTime());
  }
}
