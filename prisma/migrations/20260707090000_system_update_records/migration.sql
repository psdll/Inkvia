CREATE TABLE "SystemUpdateRecord" (
  "jobId" TEXT PRIMARY KEY,
  "fromVersion" TEXT,
  "toVersion" TEXT,
  "fromCommit" TEXT,
  "toCommit" TEXT,
  "releaseAsset" TEXT,
  "sha256" TEXT,
  "operatorUserId" TEXT,
  "operatorIp" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  "status" TEXT NOT NULL DEFAULT 'queued',
  "failedPhase" TEXT,
  "backupPath" TEXT,
  "backupSha256" TEXT,
  "oldReleasePath" TEXT,
  "newReleasePath" TEXT,
  "logPath" TEXT,
  "migrationBefore" JSONB,
  "migrationAfter" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "SystemUpdateRecord_status_startedAt_idx" ON "SystemUpdateRecord" ("status", "startedAt");
CREATE INDEX "SystemUpdateRecord_startedAt_idx" ON "SystemUpdateRecord" ("startedAt");
