CREATE INDEX CONCURRENTLY IF NOT EXISTS "AdminUserSummary_active_lastActiveAt_adminKey_idx"
ON "AdminUserSummary" ("lastActiveAt" DESC NULLS LAST, "adminKey" ASC)
WHERE "deletedAt" IS NULL;
