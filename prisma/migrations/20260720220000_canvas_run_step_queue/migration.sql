ALTER TABLE "CanvasRun"
ADD COLUMN "graphRevision64" BIGINT NOT NULL DEFAULT 1,
ADD COLUMN "requestKey" UUID,
ADD COLUMN "requestHash" CHAR(64),
ADD COLUMN "priority" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "Generation" ADD COLUMN "requestKey" UUID;
ALTER TABLE "UsageLedger" ADD COLUMN "requestKey" UUID;

CREATE TABLE "CanvasRunStep" (
  "id" BIGSERIAL NOT NULL,
  "runId" INTEGER NOT NULL,
  "authUserId" INTEGER NOT NULL,
  "stepKey" VARCHAR(256) NOT NULL,
  "nodeId" VARCHAR(256) NOT NULL,
  "nodeKind" VARCHAR(64) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "priority" INTEGER NOT NULL DEFAULT 0,
  "requestKey" UUID NOT NULL,
  "dependencies" JSONB NOT NULL DEFAULT '[]',
  "input" JSONB NOT NULL,
  "provider" VARCHAR(128),
  "providerRequestId" VARCHAR(512),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "leaseOwner" VARCHAR(256),
  "leaseUntil" TIMESTAMP(3),
  "submittedAt" TIMESTAMP(3),
  "appliedAt" TIMESTAMP(3),
  "errorCode" VARCHAR(128),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "CanvasRunStep_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CanvasRunStep_status_check" CHECK ("status" IN (
    'queued', 'leased', 'submitting', 'waiting_provider', 'applying', 'success',
    'failed', 'retry_wait', 'submission_unknown', 'cancel_requested', 'cancelled'
  ))
);

CREATE TABLE "CanvasRunOutput" (
  "id" BIGSERIAL NOT NULL,
  "runStepId" BIGINT NOT NULL,
  "outputSlot" VARCHAR(128) NOT NULL,
  "mediaId" UUID,
  "generationId" INTEGER,
  "payload" JSONB NOT NULL,
  "payloadHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CanvasRunOutput_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CanvasRun_requestKey_key" ON "CanvasRun"("requestKey");
CREATE INDEX "CanvasRun_status_priority_queuedAt_idx" ON "CanvasRun"("status", "priority", "queuedAt");
CREATE UNIQUE INDEX "UsageLedger_requestKey_key" ON "UsageLedger"("requestKey");
CREATE UNIQUE INDEX "CanvasRunStep_requestKey_key" ON "CanvasRunStep"("requestKey");
CREATE UNIQUE INDEX "CanvasRunStep_runId_stepKey_key" ON "CanvasRunStep"("runId", "stepKey");
CREATE INDEX "CanvasRunStep_status_nextRetryAt_priority_createdAt_idx" ON "CanvasRunStep"("status", "nextRetryAt", "priority", "createdAt");
CREATE INDEX "CanvasRunStep_authUserId_status_createdAt_idx" ON "CanvasRunStep"("authUserId", "status", "createdAt");
CREATE INDEX "CanvasRunStep_status_leaseUntil_idx" ON "CanvasRunStep"("status", "leaseUntil");
CREATE INDEX "CanvasRunStep_provider_providerRequestId_idx" ON "CanvasRunStep"("provider", "providerRequestId");
CREATE UNIQUE INDEX "CanvasRunOutput_runStepId_outputSlot_key" ON "CanvasRunOutput"("runStepId", "outputSlot");
CREATE INDEX "CanvasRunOutput_mediaId_idx" ON "CanvasRunOutput"("mediaId");
CREATE INDEX "CanvasRunOutput_generationId_idx" ON "CanvasRunOutput"("generationId");

ALTER TABLE "CanvasRunStep" ADD CONSTRAINT "CanvasRunStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "CanvasRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasRunStep" ADD CONSTRAINT "CanvasRunStep_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasRunOutput" ADD CONSTRAINT "CanvasRunOutput_runStepId_fkey" FOREIGN KEY ("runStepId") REFERENCES "CanvasRunStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CanvasRunOutput" ADD CONSTRAINT "CanvasRunOutput_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
