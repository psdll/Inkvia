-- Agent V2 durable runtime foundation. This migration is expand-only so the
-- existing synchronous Agent route remains compatible during the UI cutover.

ALTER TABLE "AgentConversation"
  ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "purgeAfter" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "deletedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "lastMessageAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "AgentMessage"
  ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'text',
  ADD COLUMN IF NOT EXISTS "runId" INTEGER,
  ADD COLUMN IF NOT EXISTS "sequence" INTEGER,
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'completed';

ALTER TABLE "AgentRun"
  ADD COLUMN IF NOT EXISTS "requestKey" UUID,
  ADD COLUMN IF NOT EXISTS "routeSnapshot" JSONB,
  ADD COLUMN IF NOT EXISTS "brief" JSONB,
  ADD COLUMN IF NOT EXISTS "plan" JSONB,
  ADD COLUMN IF NOT EXISTS "currentStage" TEXT,
  ADD COLUMN IF NOT EXISTS "waitingReason" TEXT,
  ADD COLUMN IF NOT EXISTS "attempt" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "availableAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "leaseOwner" TEXT,
  ADD COLUMN IF NOT EXISTS "leaseUntil" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "startedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "finishedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "errorCode" TEXT,
  ADD COLUMN IF NOT EXISTS "cancelRequestedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "AgentEvent" (
  "id" BIGSERIAL NOT NULL,
  "runId" INTEGER NOT NULL,
  "conversationId" INTEGER NOT NULL,
  "sequence" INTEGER NOT NULL,
  "type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentEvent_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AgentGenerationLink" (
  "id" BIGSERIAL NOT NULL,
  "runId" INTEGER NOT NULL,
  "conversationId" INTEGER NOT NULL,
  "messageId" INTEGER,
  "generationId" INTEGER NOT NULL,
  "taskType" TEXT NOT NULL,
  "stepKey" TEXT NOT NULL,
  "requestKey" UUID NOT NULL,
  "userDeletedAt" TIMESTAMP(3),
  "purgeAfter" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AgentGenerationLink_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AgentGenerationLink_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AgentGenerationLink_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AgentConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "AgentRun_requestKey_key" ON "AgentRun"("requestKey");
CREATE INDEX IF NOT EXISTS "AgentRun_status_availableAt_leaseUntil_idx" ON "AgentRun"("status", "availableAt", "leaseUntil");
CREATE INDEX IF NOT EXISTS "AgentRun_conversationId_createdAt_idx" ON "AgentRun"("conversationId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentMessage_conversationId_sequence_key" ON "AgentMessage"("conversationId", "sequence");
CREATE INDEX IF NOT EXISTS "AgentMessage_runId_createdAt_idx" ON "AgentMessage"("runId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentConversation_userId_deletedAt_lastMessageAt_idx" ON "AgentConversation"("userId", "deletedAt", "lastMessageAt");
CREATE INDEX IF NOT EXISTS "AgentConversation_purgeAfter_idx" ON "AgentConversation"("purgeAfter");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentEvent_runId_sequence_key" ON "AgentEvent"("runId", "sequence");
CREATE INDEX IF NOT EXISTS "AgentEvent_conversationId_id_idx" ON "AgentEvent"("conversationId", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentGenerationLink_requestKey_key" ON "AgentGenerationLink"("requestKey");
CREATE UNIQUE INDEX IF NOT EXISTS "AgentGenerationLink_runId_stepKey_key" ON "AgentGenerationLink"("runId", "stepKey");
CREATE INDEX IF NOT EXISTS "AgentGenerationLink_conversationId_createdAt_idx" ON "AgentGenerationLink"("conversationId", "createdAt");
CREATE INDEX IF NOT EXISTS "AgentGenerationLink_generationId_idx" ON "AgentGenerationLink"("generationId");
CREATE INDEX IF NOT EXISTS "AgentGenerationLink_purgeAfter_idx" ON "AgentGenerationLink"("purgeAfter");
