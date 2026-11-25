-- 用户数据导出任务表（异步打包下载）
-- 使用 IF NOT EXISTS 保证幂等：本地已通过脚本手动建表，生产经 migrate deploy 建表。
CREATE TABLE IF NOT EXISTS "UserExportJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "authUserId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "options" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "stage" TEXT,
    "filePath" TEXT,
    "fileName" TEXT,
    "fileSize" BIGINT,
    "token" TEXT,
    "error" TEXT,
    "manifest" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    CONSTRAINT "UserExportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserExportJob_status_idx" ON "UserExportJob"("status");
CREATE INDEX IF NOT EXISTS "UserExportJob_userId_idx" ON "UserExportJob"("userId");
CREATE INDEX IF NOT EXISTS "UserExportJob_expiresAt_idx" ON "UserExportJob"("expiresAt");
