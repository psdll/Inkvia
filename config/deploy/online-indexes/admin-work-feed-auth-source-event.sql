CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminWorkFeed_authUserId_sourceEventId_active_idx"
ON "AdminWorkFeed" ("authUserId", "sourceEventId" DESC)
WHERE "deletedAt" IS NULL AND "authUserId" IS NOT NULL;
