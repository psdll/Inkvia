-- CreateTable
CREATE TABLE "LiveVideoBatch" (
    "id" UUID NOT NULL,
    "authUserId" INTEGER NOT NULL,
    "requestKey" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL DEFAULT '未命名视频分组',
    "status" VARCHAR(32) NOT NULL DEFAULT 'prompt_queued',
    "skillSnapshot" JSONB NOT NULL,
    "sharedRequirement" TEXT NOT NULL DEFAULT '',
    "videoSettings" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "lastSubmissionKey" UUID,
    "submittedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveVideoBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveVideoBatchItem" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL DEFAULT '未命名视频任务',
    "sourceMediaId" UUID,
    "mediaSnapshot" JSONB NOT NULL,
    "prompt" TEXT NOT NULL DEFAULT '',
    "promptStatus" VARCHAR(32) NOT NULL DEFAULT 'prompt_queued',
    "videoStatus" VARCHAR(32) NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveVideoBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveVideoPromptJob" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "requestKey" UUID NOT NULL,
    "skillSnapshot" JSONB NOT NULL,
    "systemPrompt" TEXT NOT NULL,
    "userPrompt" TEXT NOT NULL,
    "mediaSnapshot" JSONB NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'queued',
    "generatedPrompt" TEXT,
    "errorCode" VARCHAR(128),
    "errorMessage" TEXT,
    "leaseOwner" VARCHAR(256),
    "leaseUntil" TIMESTAMP(3),
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveVideoPromptJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LiveVideoBatchOutput" (
    "id" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "requestKey" UUID NOT NULL,
    "requestSnapshot" JSONB NOT NULL,
    "status" VARCHAR(32) NOT NULL DEFAULT 'queued',
    "generationId" INTEGER,
    "errorCode" VARCHAR(128),
    "errorMessage" TEXT,
    "leaseOwner" VARCHAR(256),
    "leaseUntil" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LiveVideoBatchOutput_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "LiveVideoBatch_requestKey_key" ON "LiveVideoBatch"("requestKey");
CREATE INDEX "LiveVideoBatch_authUserId_deletedAt_createdAt_idx" ON "LiveVideoBatch"("authUserId", "deletedAt", "createdAt");
CREATE INDEX "LiveVideoBatch_authUserId_status_updatedAt_idx" ON "LiveVideoBatch"("authUserId", "status", "updatedAt");
CREATE INDEX "LiveVideoBatch_status_updatedAt_idx" ON "LiveVideoBatch"("status", "updatedAt");

CREATE UNIQUE INDEX "LiveVideoBatchItem_batchId_position_key" ON "LiveVideoBatchItem"("batchId", "position");
CREATE INDEX "LiveVideoBatchItem_batchId_promptStatus_videoStatus_idx" ON "LiveVideoBatchItem"("batchId", "promptStatus", "videoStatus");
CREATE INDEX "LiveVideoBatchItem_sourceMediaId_idx" ON "LiveVideoBatchItem"("sourceMediaId");

CREATE UNIQUE INDEX "LiveVideoPromptJob_requestKey_key" ON "LiveVideoPromptJob"("requestKey");
CREATE UNIQUE INDEX "LiveVideoPromptJob_itemId_attempt_key" ON "LiveVideoPromptJob"("itemId", "attempt");
CREATE INDEX "LiveVideoPromptJob_status_availableAt_leaseUntil_createdAt_idx" ON "LiveVideoPromptJob"("status", "availableAt", "leaseUntil", "createdAt");
CREATE INDEX "LiveVideoPromptJob_batchId_status_idx" ON "LiveVideoPromptJob"("batchId", "status");

CREATE UNIQUE INDEX "LiveVideoBatchOutput_requestKey_key" ON "LiveVideoBatchOutput"("requestKey");
CREATE UNIQUE INDEX "LiveVideoBatchOutput_generationId_key" ON "LiveVideoBatchOutput"("generationId");
CREATE UNIQUE INDEX "LiveVideoBatchOutput_itemId_attempt_key" ON "LiveVideoBatchOutput"("itemId", "attempt");
CREATE INDEX "LiveVideoBatchOutput_status_nextPollAt_leaseUntil_createdAt_idx" ON "LiveVideoBatchOutput"("status", "nextPollAt", "leaseUntil", "createdAt");
CREATE INDEX "LiveVideoBatchOutput_batchId_status_idx" ON "LiveVideoBatchOutput"("batchId", "status");

-- AddForeignKey
ALTER TABLE "LiveVideoBatch" ADD CONSTRAINT "LiveVideoBatch_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveVideoBatchItem" ADD CONSTRAINT "LiveVideoBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LiveVideoBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveVideoBatchItem" ADD CONSTRAINT "LiveVideoBatchItem_sourceMediaId_fkey" FOREIGN KEY ("sourceMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LiveVideoPromptJob" ADD CONSTRAINT "LiveVideoPromptJob_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LiveVideoBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveVideoPromptJob" ADD CONSTRAINT "LiveVideoPromptJob_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LiveVideoBatchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveVideoBatchOutput" ADD CONSTRAINT "LiveVideoBatchOutput_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "LiveVideoBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveVideoBatchOutput" ADD CONSTRAINT "LiveVideoBatchOutput_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "LiveVideoBatchItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LiveVideoBatchOutput" ADD CONSTRAINT "LiveVideoBatchOutput_generationId_fkey" FOREIGN KEY ("generationId") REFERENCES "Generation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
