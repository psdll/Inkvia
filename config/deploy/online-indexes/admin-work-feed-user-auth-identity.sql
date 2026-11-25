CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminWorkFeed_userId_authUserId_identity_idx"
ON "AdminWorkFeed" ("userId", "authUserId")
WHERE "deletedAt" IS NULL AND "authUserId" IS NOT NULL;
