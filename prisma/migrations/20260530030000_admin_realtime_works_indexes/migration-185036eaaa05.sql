-- Hot-path indexes for the admin works page lightweight list and incremental refresh.
-- Prisma migrations run in a transaction on PostgreSQL, so this file intentionally
-- avoids CREATE INDEX CONCURRENTLY. For production with large tables, apply the
-- equivalent CONCURRENTLY statements manually outside a transaction during rollout.

CREATE INDEX IF NOT EXISTS "Generation_authUserId_updatedAt_id_idx"
ON "Generation"("authUserId", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "Generation_userId_updatedAt_id_idx"
ON "Generation"("userId", "updatedAt", "id");

CREATE INDEX IF NOT EXISTS "Generation_authUserId_type_finishedAt_createdAt_id_idx"
ON "Generation"("authUserId", "type", "finishedAt", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "Generation_userId_type_finishedAt_createdAt_id_idx"
ON "Generation"("userId", "type", "finishedAt", "createdAt", "id");

CREATE INDEX IF NOT EXISTS "Generation_authUserId_type_externalTaskId_idx"
ON "Generation"("authUserId", "type", "externalTaskId")
WHERE "externalTaskId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Generation_userId_type_externalTaskId_idx"
ON "Generation"("userId", "type", "externalTaskId")
WHERE "externalTaskId" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "Log_generationId_category_action_createdAt_idx"
ON "Log"("generationId", "category", "action", "createdAt");
