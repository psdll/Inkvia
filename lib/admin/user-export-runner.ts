import path from "path";
import fs from "fs-extra";
import crypto from "crypto";
import prisma from "@/lib/prisma";
import {
  buildUserExportZip,
  getExportsDir,
  normalizeExportOptions,
  type UserExportOptions,
} from "@/lib/admin/user-export-builder";
import { validateMigrationPassphrase, wrapMigrationArchive } from "@/lib/admin/user-migration-package";

// 下载链接有效期：2 小时
const EXPORT_TTL_MS = 2 * 60 * 60 * 1000;
const USER_EXPORT_HEARTBEAT_MS = 60 * 1000;

/**
 * 入队一个导出任务，返回 jobId。
 * 同进程 fire-and-forget 立即开跑（不 await），无需等待定时 tick。
 */
export async function enqueueUserExportJob(params: {
  userId: string;
  authUserId: number | null;
  options: UserExportOptions;
  migrationPassphrase?: string;
  portable?: boolean;
}): Promise<string> {
  if (params.migrationPassphrase !== undefined) validateMigrationPassphrase(params.migrationPassphrase);
  const job = await prisma.userExportJob.create({
    data: {
      userId: params.userId,
      authUserId: params.authUserId,
      status: "pending",
      options: JSON.stringify({ ...params.options, archiveMode: params.portable ? "portable" : params.migrationPassphrase ? "migration" : "legacy" }),
      progress: 0,
      stage: "query",
    },
    select: { id: true },
  });

  // 后台异步执行，吞掉异常（runUserExportJob 内部已写回 error 状态）
  void runUserExportJob(job.id, params.migrationPassphrase).catch(() => {});

  return job.id;
}

/**
 * 实际执行导出任务：流式打包写盘，并把进度/结果写回 DB。
 */
export async function runUserExportJob(jobId: string, migrationPassphrase?: string): Promise<void> {
  const job = await prisma.userExportJob.findUnique({ where: { id: jobId } });
  if (!job) return;
  if (job.status !== "pending") return; // 防重复执行

  const outPath = path.join(getExportsDir(), `${jobId}.zip`);
  let privateDir: string | undefined;

  try {
    const claim = await prisma.userExportJob.updateMany({
      where: { id: jobId, status: "pending" },
      data: { status: "running", startedAt: new Date(), progress: 5, stage: "query" },
    });
    if (claim.count !== 1) return;

    const stored = job.options ? JSON.parse(job.options) as Partial<UserExportOptions> & { archiveMode?: string } : {};
    const portable = stored.archiveMode === "portable";
    const migration = portable || stored.archiveMode === "migration";
    if (portable) migrationPassphrase = crypto.randomBytes(32).toString("base64url");
    if (migration && !migrationPassphrase) throw new Error("MIGRATION_PASSPHRASE_REQUIRED: 服务重启后需重新输入迁移口令并创建导出任务");
    const options = normalizeExportOptions(stored);
    if (migration) {
      await fs.ensureDir(getExportsDir());
      privateDir = await fs.mkdtemp(path.join(getExportsDir(), ".migration-build-"));
      await fs.chmod(privateDir, 0o700);
    }

    let lastWritten = 5;
    const heartbeat = setInterval(() => {
      void prisma.userExportJob
        .update({ where: { id: jobId }, data: { updatedAt: new Date() } })
        .catch(() => {});
    }, USER_EXPORT_HEARTBEAT_MS);
    heartbeat.unref();
    let result: Awaited<ReturnType<typeof buildUserExportZip>>;
    try {
      result = await buildUserExportZip({
        userId: job.userId,
        authUserId: job.authUserId,
        options,
        outPath: privateDir ? path.join(privateDir, "inner.zip") : outPath,
        migrationPassphrase: migration ? migrationPassphrase : undefined,
        onProgress: async ({ stage, progress }) => {
          const reported = migration ? Math.min(progress, 90) : progress;
          if (reported - lastWritten >= 2 || stage === "done") {
            lastWritten = reported;
            await prisma.userExportJob
              .update({ where: { id: jobId }, data: { stage: migration && stage === "done" ? "pack" : stage, progress: reported } })
              .catch(() => {});
          }
        },
      });
      if (migration) await wrapMigrationArchive(path.join(privateDir!, "inner.zip"), outPath, migrationPassphrase!, portable);
    } finally { clearInterval(heartbeat); }
    const finalSize = migration ? (await fs.stat(outPath)).size : result.fileSize;
    if (privateDir) { await fs.remove(privateDir); privateDir = undefined; }

    const token = crypto.randomBytes(24).toString("hex");
    await prisma.userExportJob.update({
      where: { id: jobId },
      data: {
        status: "done",
        stage: "done",
        progress: 100,
        filePath: outPath,
        fileName: migration ? `user_migration_${new Date().toISOString().slice(0, 10)}.zip` : result.fileName,
        fileSize: BigInt(finalSize),
        token,
        manifest: JSON.stringify(result.manifest),
        finishedAt: new Date(),
        expiresAt: new Date(Date.now() + EXPORT_TTL_MS),
      },
    });
  } catch (err) {
    // 清理可能产生的半成品文件
    await fs.remove(outPath).catch(() => {});
    if (privateDir) await fs.remove(privateDir).catch(() => {});
    const message = err instanceof Error ? err.message : String(err);
    await prisma.userExportJob
      .update({
        where: { id: jobId },
        data: { status: "error", error: message.slice(0, 2000), finishedAt: new Date() },
      })
      .catch(() => {});
    console.error("[user-export] 任务失败", jobId, message);
  }
}
