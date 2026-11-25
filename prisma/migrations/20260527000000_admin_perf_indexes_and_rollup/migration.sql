-- Generation: add sizeBytes column (cached) + compound indexes for admin hot paths
ALTER TABLE "Generation" ADD COLUMN IF NOT EXISTS "sizeBytes" INTEGER;

CREATE INDEX IF NOT EXISTS "Generation_authUserId_createdAt_idx" ON "Generation"("authUserId", "createdAt");
CREATE INDEX IF NOT EXISTS "Generation_userId_createdAt_idx" ON "Generation"("userId", "createdAt");
CREATE INDEX IF NOT EXISTS "Generation_authUserId_status_idx" ON "Generation"("authUserId", "status");
CREATE INDEX IF NOT EXISTS "Generation_authUserId_type_idx" ON "Generation"("authUserId", "type");
CREATE INDEX IF NOT EXISTS "Generation_createdAt_idx" ON "Generation"("createdAt");
CREATE INDEX IF NOT EXISTS "Generation_status_createdAt_idx" ON "Generation"("status", "createdAt");

-- Pre-aggregated daily stats per user, populated by background job.
-- 用 bucketKey UNIQUE 代替 (day, authUserId, userId) 复合 UNIQUE,
-- 因为 PostgreSQL 中 NULL 在唯一约束里互不相等,会破坏 Prisma upsert 语义。
CREATE TABLE IF NOT EXISTS "AnalyticsDailyByUser" (
    "id" SERIAL PRIMARY KEY,
    "bucketKey" TEXT NOT NULL UNIQUE,
    "day" TEXT NOT NULL,
    "authUserId" INTEGER,
    "userId" TEXT NOT NULL,
    "generationCount" INTEGER NOT NULL DEFAULT 0,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "imageCount" INTEGER NOT NULL DEFAULT 0,
    "videoCount" INTEGER NOT NULL DEFAULT 0,
    "faceCount" INTEGER NOT NULL DEFAULT 0,
    "otherCount" INTEGER NOT NULL DEFAULT 0,
    "storageBytes" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE INDEX IF NOT EXISTS "AnalyticsDailyByUser_day_idx" ON "AnalyticsDailyByUser"("day");
CREATE INDEX IF NOT EXISTS "AnalyticsDailyByUser_authUserId_day_idx" ON "AnalyticsDailyByUser"("authUserId", "day");
