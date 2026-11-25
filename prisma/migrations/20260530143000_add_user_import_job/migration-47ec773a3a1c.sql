CREATE TABLE IF NOT EXISTS "UserImportJob" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "stage" TEXT,
  "progress" INTEGER NOT NULL DEFAULT 0,
  "filePath" TEXT,
  "fileName" TEXT,
  "fileSize" BIGINT,
  "error" TEXT,
  "manifest" TEXT,
  "stats" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "UserImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "UserImportJob_status_idx" ON "UserImportJob"("status");
CREATE INDEX IF NOT EXISTS "UserImportJob_expiresAt_idx" ON "UserImportJob"("expiresAt");
