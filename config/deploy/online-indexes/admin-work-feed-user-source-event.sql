CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminWorkFeed_userId_sourceEventId_active_idx"
ON "AdminWorkFeed" ("userId", "sourceEventId" DESC)
WHERE "deletedAt" IS NULL AND "authUserId" IS NULL;
