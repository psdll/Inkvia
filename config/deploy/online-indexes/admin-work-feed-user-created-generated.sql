CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminWorkFeed_userId_createdAt_generated_active_idx"
ON "AdminWorkFeed" ("userId", "createdAt" DESC, "generationId" DESC)
WHERE "deletedAt" IS NULL AND "authUserId" IS NULL AND "type" <> 'import';
