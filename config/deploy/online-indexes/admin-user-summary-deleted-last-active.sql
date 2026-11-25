CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminUserSummary_deletedAt_lastActiveAt_idx"
ON "AdminUserSummary" ("deletedAt", "lastActiveAt");
