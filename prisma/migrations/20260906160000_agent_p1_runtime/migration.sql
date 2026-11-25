-- AlterTable
ALTER TABLE "AgentConversation" ADD COLUMN     "summaryRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "summarySource" JSONB;

-- AlterTable
ALTER TABLE "AgentRun" ADD COLUMN     "activeMs" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "budgetPolicy" JSONB,
ADD COLUMN     "budgetRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "deliverySpec" JSONB,
ADD COLUMN     "lastProgressAt" TIMESTAMP(3),
ADD COLUMN     "planRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "repairCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "runtimeVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "skillSnapshot" JSONB,
ADD COLUMN     "validationSummary" JSONB;

-- CreateTable
CREATE TABLE "AgentStepExecution" (
    "id" TEXT NOT NULL,
    "runId" INTEGER NOT NULL,
    "stepKey" TEXT NOT NULL,
    "introducedRevision" INTEGER NOT NULL,
    "definitionSnapshot" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "version" INTEGER NOT NULL DEFAULT 1,
    "activeAttemptNo" INTEGER NOT NULL DEFAULT 0,
    "result" JSONB,
    "errorCode" TEXT,
    "nextEligibleAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentStepExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStepAttempt" (
    "id" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "attemptNo" INTEGER NOT NULL,
    "requestKey" UUID NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'prepared',
    "inputSnapshot" JSONB NOT NULL,
    "inputDigest" TEXT NOT NULL,
    "submissionRefs" JSONB NOT NULL,
    "reservedUnits" INTEGER NOT NULL DEFAULT 0,
    "budgetRevision" INTEGER NOT NULL,
    "errorClass" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentStepAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentArtifact" (
    "id" TEXT NOT NULL,
    "runId" INTEGER NOT NULL,
    "stepId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "outputSlot" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "generationId" INTEGER,
    "source" JSONB,
    "storageRef" TEXT,
    "text" TEXT,
    "contentVersion" TEXT NOT NULL,
    "availability" TEXT NOT NULL DEFAULT 'unverified',
    "facts" JSONB,
    "observation" JSONB,
    "validationReport" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentCallRecord" (
    "id" TEXT NOT NULL,
    "runId" INTEGER,
    "stepId" TEXT,
    "attemptId" TEXT,
    "logicalOperationKey" TEXT NOT NULL,
    "callAttemptNo" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "routeSnapshot" JSONB,
    "inputDigest" TEXT,
    "result" JSONB,
    "usage" JSONB,
    "priceSnapshot" JSONB,
    "reservedInputTokens" INTEGER NOT NULL,
    "reservedOutputTokens" INTEGER NOT NULL,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "reservedAmount" DECIMAL(20,8),
    "amount" DECIMAL(20,8),
    "currency" TEXT,
    "costState" TEXT NOT NULL DEFAULT 'unknown',
    "budgetRevision" INTEGER NOT NULL,
    "errorCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "AgentCallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentStepExecution_runId_status_nextEligibleAt_idx" ON "AgentStepExecution"("runId", "status", "nextEligibleAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStepExecution_runId_stepKey_key" ON "AgentStepExecution"("runId", "stepKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStepAttempt_requestKey_key" ON "AgentStepAttempt"("requestKey");

-- CreateIndex
CREATE INDEX "AgentStepAttempt_state_startedAt_idx" ON "AgentStepAttempt"("state", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStepAttempt_stepId_attemptNo_key" ON "AgentStepAttempt"("stepId", "attemptNo");

-- CreateIndex
CREATE INDEX "AgentArtifact_runId_stepId_outputSlot_idx" ON "AgentArtifact"("runId", "stepId", "outputSlot");

-- CreateIndex
CREATE INDEX "AgentArtifact_generationId_idx" ON "AgentArtifact"("generationId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentArtifact_attemptId_outputSlot_key" ON "AgentArtifact"("attemptId", "outputSlot");

-- CreateIndex
CREATE INDEX "AgentCallRecord_runId_startedAt_idx" ON "AgentCallRecord"("runId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentCallRecord_state_startedAt_idx" ON "AgentCallRecord"("state", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentCallRecord_logicalOperationKey_callAttemptNo_key" ON "AgentCallRecord"("logicalOperationKey", "callAttemptNo");

-- AddForeignKey
ALTER TABLE "AgentStepExecution" ADD CONSTRAINT "AgentStepExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStepAttempt" ADD CONSTRAINT "AgentStepAttempt_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStepExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentArtifact" ADD CONSTRAINT "AgentArtifact_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentArtifact" ADD CONSTRAINT "AgentArtifact_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStepExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentArtifact" ADD CONSTRAINT "AgentArtifact_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "AgentStepAttempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentCallRecord" ADD CONSTRAINT "AgentCallRecord_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;
