CREATE TABLE "VirtualAvatar" (
    "id" SERIAL NOT NULL,
    "ownerUserId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "sourceUrl" TEXT NOT NULL,
    "coverImage" TEXT,
    "provider" TEXT NOT NULL DEFAULT 'apimart',
    "projectName" TEXT NOT NULL DEFAULT 'default',
    "groupId" TEXT,
    "taskId" TEXT,
    "assetId" TEXT,
    "assetUri" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "failedReason" TEXT,
    "tags" TEXT NOT NULL DEFAULT '[]',
    "rawResponse" JSONB,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VirtualAvatar_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VirtualAvatar_ownerUserId_status_createdAt_idx" ON "VirtualAvatar"("ownerUserId", "status", "createdAt");
CREATE INDEX "VirtualAvatar_taskId_idx" ON "VirtualAvatar"("taskId");
CREATE INDEX "VirtualAvatar_assetUri_idx" ON "VirtualAvatar"("assetUri");

ALTER TABLE "VirtualAvatar" ADD CONSTRAINT "VirtualAvatar_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
