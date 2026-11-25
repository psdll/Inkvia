CREATE TABLE "PromptReverseTask" (
    "id" SERIAL NOT NULL,
    "authUserId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "systemPrompt" TEXT NOT NULL,
    "userPrompt" TEXT NOT NULL,
    "requestedModel" TEXT,
    "model" TEXT,
    "mediaUrls" JSONB NOT NULL DEFAULT '[]',
    "resolvedMediaUrls" JSONB NOT NULL DEFAULT '[]',
    "generatedPrompt" TEXT,
    "errorMsg" TEXT,
    "rawResponse" JSONB,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromptReverseTask_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PromptReverseTask_authUserId_createdAt_idx" ON "PromptReverseTask"("authUserId", "createdAt");
CREATE INDEX "PromptReverseTask_authUserId_status_createdAt_idx" ON "PromptReverseTask"("authUserId", "status", "createdAt");
CREATE INDEX "PromptReverseTask_authUserId_deletedAt_createdAt_idx" ON "PromptReverseTask"("authUserId", "deletedAt", "createdAt");

ALTER TABLE "PromptReverseTask" ADD CONSTRAINT "PromptReverseTask_authUserId_fkey" FOREIGN KEY ("authUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
