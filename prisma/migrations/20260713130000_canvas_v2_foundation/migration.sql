-- Canvas V2 persistence is additive. User data cleanup is handled by a separate guarded script.
CREATE TABLE "CanvasProject" (
  "id" SERIAL NOT NULL,
  "authUserId" INTEGER NOT NULL,
  "name" TEXT NOT NULL DEFAULT '未命名项目',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "deletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanvasProject_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Canvas"
  ADD COLUMN "projectId" INTEGER,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "CanvasRun" (
  "id" SERIAL NOT NULL,
  "authUserId" INTEGER NOT NULL,
  "canvasId" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "graphRevision" INTEGER NOT NULL,
  "state" JSONB NOT NULL DEFAULT '{}',
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP(3),
  CONSTRAINT "CanvasRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Canvas_authUserId_projectId_sortOrder_idx" ON "Canvas"("authUserId", "projectId", "sortOrder");
CREATE INDEX "Canvas_projectId_deletedAt_sortOrder_idx" ON "Canvas"("projectId", "deletedAt", "sortOrder");
CREATE INDEX "CanvasProject_authUserId_deletedAt_sortOrder_idx" ON "CanvasProject"("authUserId", "deletedAt", "sortOrder");
CREATE INDEX "CanvasProject_authUserId_updatedAt_idx" ON "CanvasProject"("authUserId", "updatedAt");
CREATE INDEX "CanvasRun_authUserId_updatedAt_idx" ON "CanvasRun"("authUserId", "updatedAt");
CREATE INDEX "CanvasRun_canvasId_status_updatedAt_idx" ON "CanvasRun"("canvasId", "status", "updatedAt");

ALTER TABLE "CanvasProject"
  ADD CONSTRAINT "CanvasProject_authUserId_fkey"
  FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Canvas"
  ADD CONSTRAINT "Canvas_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "CanvasProject"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "CanvasRun"
  ADD CONSTRAINT "CanvasRun_authUserId_fkey"
  FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CanvasRun"
  ADD CONSTRAINT "CanvasRun_canvasId_fkey"
  FOREIGN KEY ("canvasId") REFERENCES "Canvas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
