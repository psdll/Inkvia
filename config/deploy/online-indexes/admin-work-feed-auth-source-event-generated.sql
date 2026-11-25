CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminWorkFeed_authUserId_sourceEventId_generated_active_idx"
ON "AdminWorkFeed" ("authUserId", "sourceEventId" DESC, "generationId" ASC)
WHERE "deletedAt" IS NULL AND "authUserId" IS NOT NULL AND "type" <> 'import';
