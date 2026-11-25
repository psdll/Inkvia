CREATE INDEX CONCURRENTLY IF NOT EXISTS "LiveVideoBatch_active_history_idx"
ON "LiveVideoBatch" ("authUserId", "createdAt" DESC, "id" DESC)
WHERE "deletedAt" IS NULL;
