-- CreateTable
CREATE TABLE "ImageBatch" (
    "id" UUID NOT NULL,
    "authUserId" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL DEFAULT '未命名批次',
    "mode" VARCHAR(32) NOT NULL DEFAULT 'style_replication',
    "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "sharedPrompt" TEXT NOT NULL DEFAULT '',
    "sharedSettings" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 1,
    "submittedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageBatchItem" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL DEFAULT '未命名任务',
    "prompt" TEXT NOT NULL DEFAULT '',
    "includeSharedPrompt" BOOLEAN NOT NULL DEFAULT true,
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "outputCount" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "lastSubmittedSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageBatchMedia" (
    "id" BIGSERIAL NOT NULL,
    "batchId" UUID NOT NULL,
    "itemId" UUID,
    "mediaId" UUID NOT NULL,
    "role" VARCHAR(32) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageBatchMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImageBatchOutput" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "status" VARCHAR(32) NOT NULL DEFAULT 'queued',
    "requestKey" UUID NOT NULL,
    "requestSnapshot" JSONB NOT NULL,
    "generationId" INTEGER,
    "errorCode" VARCHAR(128),
    "errorMessage" TEXT,
    "leaseOwner" VARCHAR(256),
    "leaseUntil" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImageBatchOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ImageBatch_authUserId_updatedAt_idx" ON "ImageBatch"("authUserId", "updatedAt");
CREATE INDEX "ImageBatch_authUserId_status_updatedAt_idx" ON "ImageBatch"("authUserId", "status", "updatedAt");
CREATE INDEX "ImageBatch_status_submittedAt_idx" ON "ImageBatch"("status", "submittedAt");
CREATE UNIQUE INDEX "ImageBatchItem_batchId_position_key" ON "ImageBatchItem"("batchId", "position");
CREATE INDEX "ImageBatchItem_batchId_status_idx" ON "ImageBatchItem"("batchId", "status");
CREATE INDEX "ImageBatchMedia_batchId_itemId_role_position_idx" ON "ImageBatchMedia"("batchId", "itemId", "role", "position");
CREATE INDEX "ImageBatchMedia_mediaId_idx" ON "ImageBatchMedia"("mediaId");
CREATE INDEX "ImageBatchMedia_itemId_idx" ON "ImageBatchMedia"("itemId");
CREATE UNIQUE INDEX "ImageBatchOutput_requestKey_key" ON "ImageBatchOutput"("requestKey");
CREATE UNIQUE INDEX "ImageBatchOutput_generationId_key" ON "ImageBatchOutput"("generationId");
CREATE UNIQUE INDEX "ImageBatchOutput_itemId_slotIndex_attempt_key" ON "ImageBatchOutput"("itemId", "slotIndex", "attempt");
CREATE INDEX "ImageBatchOutput_status_nextPollAt_createdAt_idx" ON "ImageBatchOutput"("status", "nextPollAt", "createdAt");
CREATE INDEX "ImageBatchOutput_status_leaseUntil_idx" ON "ImageBatchOutput"("status", "leaseUntil");
CREATE INDEX "ImageBatchOutput_batchId_status_idx" ON "ImageBatchOutput"("batchId", "status");

-- AddForeignKey
ALTER TABLE "ImageBatch" ADD CONSTRAINT "ImageBatch_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImageBatchItem" ADD CONSTRAINT "ImageBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImageBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImageBatchMedia" ADD CONSTRAINT "ImageBatchMedia_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImageBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImageBatchMedia" ADD CONSTRAINT "ImageBatchMedia_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ImageBatchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImageBatchMedia" ADD CONSTRAINT "ImageBatchMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ImageBatchOutput" ADD CONSTRAINT "ImageBatchOutput_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImageBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImageBatchOutput" ADD CONSTRAINT "ImageBatchOutput_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ImageBatchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImageBatchOutput" ADD CONSTRAINT "ImageBatchOutput_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
