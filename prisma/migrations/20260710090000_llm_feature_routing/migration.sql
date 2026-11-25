ALTER TABLE "PromptReverseTask" ADD COLUMN "llmProviderId" TEXT;

CREATE INDEX "Log_action_createdAt_idx" ON "Log"("action", "createdAt");
