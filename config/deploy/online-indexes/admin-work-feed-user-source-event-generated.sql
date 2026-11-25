CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminWorkFeed_userId_sourceEventId_generated_active_idx"
ON "AdminWorkFeed" ("userId", "sourceEventId" DESC, "generationId" ASC)
WHERE "deletedAt" IS NULL AND "authUserId" IS NULL AND "type" <> 'import';
